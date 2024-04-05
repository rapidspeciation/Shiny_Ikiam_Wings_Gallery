library(shiny)
library(dplyr)
library(readxl)
library(stringr)
library(shinyWidgets)
library(googlesheets4)
gs4_deauth()  # Use gs4_deauth() to indicate no need for google authentication

# Define the paths to the RSD files
# RSD files were used to avoid troubleshooting date format after loading from csv files
coll_data_rsd_path <- "Coll_data.rsd"
photo_links_rsd_path <- "PhotoLinks.rsd"

# Function to load and save data
load_and_save_data <- function() {
  # Load data from Google Sheets
  Coll_data <- read_sheet("1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4", sheet = "Collection_data", col_types = "c")
  PhotoLinks <- read_sheet("1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4", sheet = "Photo_links", col_types = "c")
  
  # Apply initial transformation for dates
  Coll_data <- Coll_data %>%
    mutate(across(.cols = names(.)[grepl("date", names(.))], .fns = ~as.Date(., format = "%d-%m-%Y")))
  
  message("Data loaded from Google Sheets.")
  
  return(list(Coll_data = Coll_data, PhotoLinks = PhotoLinks))
}

process_and_save_data <- function(Coll_data, PhotoLinks) {
  # Transform PhotoLinks for URLs
  Photo_Links <- PhotoLinks %>%
    mutate(URL_to_view = gsub("https://drive.google.com/file/d/(.*)/view\\?usp=drivesdk", 
                              "https://drive.google.com/thumbnail?id=\\1&sz=w2000", URL),
           CAM_ID = str_extract(Name, ".*(?=[dv]\\.JPG)"))
  
  # Create separate dataframes for dorsal and ventral URLs
  Dorsal_links <- Photo_Links %>%
    filter(str_detect(Name, "d\\.JPG")) %>%
    select(CAM_ID, URLd = URL_to_view)
  
  Ventral_links <- Photo_Links %>%
    filter(str_detect(Name, "v\\.JPG")) %>%
    select(CAM_ID, URLv = URL_to_view)
  
  # Merge Collection_data with Dorsal and Ventral URLs
  Collection_data <- Coll_data %>%
    mutate(CAM_ID = if_else(!is.na(`CAM_ID insectary`) & `CAM_ID insectary` != "NA", 
                            `CAM_ID insectary`, CAM_ID)) %>%
    left_join(Dorsal_links, by = "CAM_ID") %>%
    left_join(Ventral_links, by = "CAM_ID") %>%
    mutate(Edited = FALSE) # Ensure the Edited column is added and set to FALSE
  
  # Save the processed data to RSD files
  saveRDS(Collection_data, coll_data_rsd_path)
  saveRDS(Photo_Links, photo_links_rsd_path) # Optionally save if you need Photo_Links separately
  
  return(Collection_data)
}

# Check if RSD files exist and load or download data accordingly
if(!file.exists(coll_data_rsd_path) | !file.exists(photo_links_rsd_path)) {
  data_lists <- load_and_save_data()  # Load fresh data
  # Process and save this fresh data immediately after loading
  Collection_data <- process_and_save_data(data_lists$Coll_data, data_lists$PhotoLinks)
} else {
  # RSD files exist, load data from RSD files instead
  Collection_data <- readRDS(coll_data_rsd_path)
}

ui <- navbarPage("Ikiam Wings Gallery",
                 tabPanel("Search by Taxa",
                          fluidPage(
                            fluidRow(
                              column(3, selectizeInput("taxa_family_selection", "Select Family", choices = c("All" = "All", unique(Collection_data$Family)), selected = "All", options = list(placeholder = 'Choose a family'))),
                              column(3, selectizeInput("taxa_subfamily_selection", "Select Subfamily", choices = c("All" = "All", unique(Collection_data$Subfamily)), selected = "All", options = list(placeholder = 'Choose a subfamily'))),
                              column(3, selectizeInput("taxa_tribe_selection", "Select Tribe", choices = c("All" = "All", unique(Collection_data$Tribe)), selected = "All", options = list(placeholder = 'Choose a tribe'))),
                              column(3, selectizeInput("taxa_species_selection", "Select Species", choices = c("All" = "All", unique(Collection_data$SPECIES)), selected = "All", multiple = TRUE, options = list(placeholder = 'Choose species')))
                            ),
                            fluidRow(
                              column(3, selectizeInput("taxa_subspecies_selection", "Select Subspecies", choices = c("All" = "All", unique(Collection_data$Subspecies_Form)), selected = "All", multiple = TRUE, options = list(placeholder = 'Choose subspecies'))),
                              column(3, selectInput("taxa_sex_selection", "Select Sex", choices = c("male", "female", "male and female"), selected = "male and female")),
                              column(3, selectInput("taxa_side_selection", "Select Side", choices = c("Dorsal", "Ventral", "Dorsal and Ventral"), selected = "Dorsal and Ventral")),
                              column(3, 
                                     checkboxInput("one_per_subspecies_sex", "One Per Subspecies/Sex", FALSE),
                                     checkboxInput("exclude_without_photos", "Only Indiv. With Photos", TRUE)
                              )
                            ),
                            fluidRow(
                              column(3, selectInput("sort_by", "Sort By", choices = c("Row Number", "CAM_ID", "Preservation_date"), selected = "Preservation_date")),
                              column(3, selectInput("sort_order", "Sort Order", choices = c("Ascending" = "asc", "Descending" = "desc"), selected = "asc")),
                              column(3, actionButton("taxa_show_thumbnails", "Show Thumbnails", class = "btn-primary")),
                              column(3, actionButton("update_database", "Update Database", class = "btn-primary", style="background-color: #262626"))
                            ),
                            uiOutput("taxa_thumbnails_display")
                          )
                 ),
                 tabPanel("Search by CAMID",
                          fluidPage(
                            fluidRow(
                              column(12,
                                     selectizeInput("camid_input", "Enter CAMID(s)", choices = unique(Collection_data$CAM_ID), multiple = TRUE, options = list(placeholder = 'Enter one or more CAMIDs')),
                                     actionButton("search_camid", "Search", class = "btn-primary")
                              )
                            ),
                            uiOutput("camid_search_results")
                          )
                 )
) 

# Server logic
server <- function(input, output, session) {
  # Server: Add an observer for the 'Update database' button
  observeEvent(input$update_database, {
    data_lists <- load_and_save_data()  # Load fresh data from Google Sheets
    # Process and save the fresh data
    Collection_data <<- process_and_save_data(data_lists$Coll_data, data_lists$PhotoLinks)
  })
  
  # Observers for dynamically updating taxa selection inputs based on higher level selections
  observe({
    filteredData <- Collection_data %>%
      dplyr::filter(Family == input$taxa_family_selection | input$taxa_family_selection == "All")
    updateSelectizeInput(session, "taxa_subfamily_selection", choices = c("All" = "All", unique(filteredData$Subfamily)))
  })

  observe({
    filteredData <- Collection_data %>%
      dplyr::filter(Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All")
    updateSelectizeInput(session, "taxa_tribe_selection", choices = c("All" = "All", unique(filteredData$Tribe)))
  })

  observe({
    filteredData <- Collection_data %>%
      dplyr::filter(Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All")
    updateSelectizeInput(session, "taxa_species_selection", choices = c("All" = "All", unique(filteredData$SPECIES)))
  })

  observe({
    filteredData <- Collection_data %>%
      dplyr::filter(SPECIES %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection)
    updateSelectizeInput(session, "taxa_subspecies_selection", choices = c("All" = "All", unique(filteredData$Subspecies_Form)), selected = "All") 
  })
  
  # Function to render thumbnails based on filtered data
  renderThumbnails <- function(displayId, filteredData) {
    output[[displayId]] <- renderUI({
      if (nrow(filteredData) > 0) {
        img_tags <- lapply(1:nrow(filteredData), function(i) {
          # Determine which images to display based on side selection
          img_display <- switch(input$taxa_side_selection,
                                "Dorsal" = div(style = "flex: 1;", img(src = filteredData$URLd[i], alt = "Dorsal Side", style = "max-width: 100%; height: auto;")),
                                "Ventral" = div(style = "flex: 1;", img(src = filteredData$URLv[i], alt = "Ventral Side", style = "max-width: 100%; height: auto;")),
                                "Dorsal and Ventral" = tagList(
                                  div(style = "flex: 1;", img(src = filteredData$URLd[i], alt = "Dorsal Side", style = "max-width: 100%; height: auto;")),
                                  div(style = "flex: 1;", img(src = filteredData$URLv[i], alt = "Ventral Side", style = "max-width: 100%; height: auto;"))
                                )
          )
          
          tagList(
            h3(style = "font-weight: bold; font-size: larger;", paste("CAM ID:", filteredData$CAM_ID[i])),
            div(style = "display: flex; justify-content: space-around;", img_display),
            p(paste("Species:", filteredData$SPECIES[i])),
            p(paste("Subspecies/Form:", ifelse(is.na(filteredData$Subspecies_Form[i]), "N/A", filteredData$Subspecies_Form[i]))),
            p(paste("Sex:", ifelse(is.na(filteredData$Sex[i]), "N/A", filteredData$Sex[i])))
          )
        })
        do.call(tagList, img_tags)
      } else {
        return("No data available for the selected criteria.")
      }
    })
  }
  
  # Observe event for "Search by Taxa" action button
  observeEvent(input$taxa_show_thumbnails, {
    filteredData <- Collection_data %>%
      dplyr::filter((Family == input$taxa_family_selection | input$taxa_family_selection == "All") &
                      (Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All") &
                      (Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All") &
                      (SPECIES %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection) &
                      (Subspecies_Form %in% input$taxa_subspecies_selection | "All" %in% input$taxa_subspecies_selection) &
                      (Sex == input$taxa_sex_selection | input$taxa_sex_selection == "male and female"))
    
    # Exclude individuals without photos if the checkbox is checked
    if (input$exclude_without_photos) {
      filteredData <- filteredData %>%
        filter(!is.na(URLd) | !is.na(URLv))
    }
    
    # Limit to one individual per subspecies and sex if the checkbox is checked
    if (input$one_per_subspecies_sex) {
      filteredData <- filteredData %>%
        group_by(Subspecies_Form, Sex) %>%
        slice(1) %>%
        ungroup()
    }
    
    # Apply sorting based on user selection
    if(input$sort_by != "Row Number") {
      sortByColumn <- sym(input$sort_by)
      filteredData <- if(input$sort_order == "asc") {
        filteredData %>% arrange(!!sortByColumn)
      } else {
        filteredData %>% arrange(desc(!!sortByColumn))
      }
    }
    
    renderThumbnails("taxa_thumbnails_display", filteredData)
  })
  
  # Observe event for "Search by CAMID" action button
  observeEvent(input$search_camid, {
    filteredData <- Collection_data %>%
      dplyr::filter(CAM_ID %in% input$camid_input)
    
    renderThumbnails("camid_search_results", filteredData)
  })
}

# Run the application
shinyApp(ui = ui, server = server)
