library(shiny)
library(dplyr)
library(readxl)
library(stringr)
library(shinyWidgets)
library(googlesheets4)
gs4_deauth()  # Use gs4_deauth() to indicate no need for google authentication
Sys.setlocale(locale = "en_US.UTF-8") # Change time language to English so R can parse dates from google sheets properly (e.g. 1-Jan-22 to January 1st, 2022)

# Define the paths to the RSD files
# RSD files were used to avoid troubleshooting date format after loading from csv files
Collection_data_rsd_path <- "Coll_data.rsd"
photo_links_rsd_path <- "PhotoLinks.rsd"
CRISPR_rsd_path <- "CRISPR.rsd"

# Function to load and save data
Download_data <- function() {
  # Load data from Google Sheets
  Collection_data <- read_sheet("1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4", sheet = "Collection_data", col_types = "c")
  PhotoLinks <- read_sheet("1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4", sheet = "Photo_links", col_types = "c")
  CRISPR <- read_sheet("1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4", sheet = "CRISPR", col_types = "c")
  
  message("Data loaded from Google Sheets.")
  
  return(list(Collection_data=Collection_data, PhotoLinks=PhotoLinks, CRISPR=CRISPR))
}

process_and_save_data <- function(data) {
  # Transform PhotoLinks for URLs
  data$Photo_Links <- data$PhotoLinks %>%
    mutate(URL_to_view = gsub("https://drive.google.com/file/d/(.*)/view\\?usp=drivesdk", 
                              "https://drive.google.com/thumbnail?id=\\1&sz=w2000", URL),
           CAM_ID = str_extract(Name, ".*(?=[dv]\\.JPG)"))
  
  # Create separate dataframes for dorsal and ventral URLs
  Dorsal_links <- data$Photo_Links %>%
    filter(str_detect(Name, "d\\.JPG")) %>%
    select(CAM_ID, URLd = URL_to_view)
  
  Ventral_links <- data$Photo_Links %>%
    filter(str_detect(Name, "v\\.JPG")) %>%
    select(CAM_ID, URLv = URL_to_view)
  
  data$Collection_data <- data$Collection_data %>%
    # Convert strings to dates
    mutate(across(.cols = names(.)[grepl("date", names(.))], .fns = ~as.Date(., format = "%d-%b-%y"))) %>%
    # Merge Collection_data with Dorsal and Ventral URLs
    mutate(CAM_ID = if_else(!is.na(`CAM_ID_insectary`) & `CAM_ID_insectary` != "NA", 
                            `CAM_ID_insectary`, CAM_ID)) %>%
    left_join(Dorsal_links, by = "CAM_ID") %>%
    left_join(Ventral_links, by = "CAM_ID") %>%
    # Convert Preservation_date back to string to show in UI
    mutate(Preservation_date_formatted = format(as.Date(Preservation_date), "%d/%b/%Y"))
  
  data$CRISPR <- data$CRISPR %>%
    mutate(across(.cols = names(.)[grepl("date", names(.))], .fns = ~as.Date(., format = "%d-%b-%y")))
  
  # Save the processed data to RSD files
  saveRDS(data$Collection_data, Collection_data_rsd_path)
  saveRDS(data$CRISPR, CRISPR_rsd_path)
  saveRDS(data$Photo_Links, photo_links_rsd_path) # Optional
  
  return(data)
}

#Download or load local database
if (!file.exists(Collection_data_rsd_path) || !file.exists(CRISPR_rsd_path)) {
  # Load data from Google Sheets and process it
  rawData <- Download_data()
  data <- process_and_save_data(rawData)
} else {
  # Load data from RSD files
  data <- list(
    Collection_data = readRDS(Collection_data_rsd_path),
    Photo_Links = readRDS(photo_links_rsd_path),
    CRISPR = readRDS(CRISPR_rsd_path)
  )
}

ui <- navbarPage(
  title = "Ikiam Wings Gallery",
  header = fluidPage(
    fluidRow(
      column(3, actionButton("update_database", "Update Database", class = "btn-primary", style="background-color: #262626; height: 50%"), align = "center"),
      column(3, selectInput("sort_by", "Sort By", choices = c("Row Number", "CAM_ID", "Preservation_date"), selected = "Preservation_date")),
      column(3, selectInput("sort_order", "Sort Order", choices = c("Ascending" = "asc", "Descending" = "desc"), selected = "desc")),
      column(3, 
             checkboxInput("exclude_without_photos", "Only Indiv. With Photos", TRUE),
             checkboxInput("enable_zoom", "Zoom In Photos", FALSE)
      )
    ),
    uiOutput("zoom_controls")
  ),
  tabPanel("Search by Taxa",
          fluidPage(
            fluidRow(
              column(3, selectizeInput("taxa_family_selection", "Select Family", choices = c("All" = "All", unique(data$Collection_data$Family)), selected = "All", options = list(placeholder = 'Choose a family'))),
              column(3, selectizeInput("taxa_subfamily_selection", "Select Subfamily", choices = c("All" = "All", unique(data$Collection_data$Subfamily)), selected = "All", options = list(placeholder = 'Choose a subfamily'))),
              column(3, selectizeInput("taxa_tribe_selection", "Select Tribe", choices = c("All" = "All", unique(data$Collection_data$Tribe)), selected = "All", options = list(placeholder = 'Choose a tribe'))),
              column(3, selectizeInput("taxa_species_selection", "Select Species", choices = c("All" = "All", unique(data$Collection_data$SPECIES)), multiple = TRUE, options = list(placeholder = 'Choose species')))
            ),
            fluidRow(
              column(3, selectizeInput("taxa_subspecies_selection", "Select Subspecies", choices = c("All" = "All", unique(data$Collection_data$Subspecies_Form)), selected = "All", multiple = TRUE, options = list(placeholder = 'Choose subspecies'))),
              column(3, selectInput("taxa_sex_selection", "Select Sex", choices = c("male", "female", "male and female"), selected = "male and female")),
              column(3, selectInput("taxa_side_selection", "Select Side", choices = c("Dorsal", "Ventral", "Dorsal and Ventral"), selected = "Dorsal and Ventral")),
              column(3, 
                     checkboxInput("one_per_subspecies_sex", "One Per Subspecies/Sex", FALSE)
              )
            ),
            fluidRow(
              column(3, actionButton("taxa_show_photos", "Show Photos", class = "btn-primary"))
            ),
            uiOutput("taxa_photos_display")
          )
  ),
  tabPanel("CRISPR",
          fluidPage(
            fluidRow(
              column(3, selectizeInput("crispr_species_selection", "Select Species",  choices = c("All", unique(data$CRISPR$Species)), selected = "All", multiple = TRUE, options = list(placeholder = 'Choose a species'))),
              column(3, selectInput("crispr_sex_selection", "Select Sex", choices = c("male", "female", "male and female"), selected = "male and female")),
              column(3, selectInput("crispr_mutant_selection", "Mutant", choices = c("Yes", "No", "Check", "All"), selected = "All"))
            ),
            fluidRow(
              column(12, actionButton("crispr_show_photos", "Show Photos", class = "btn-primary"))
            ),
            uiOutput("crispr_photos_display")
          )
  ),
  tabPanel("Search by CAMID",
          fluidPage(
            fluidRow(
              column(12,
                     selectizeInput("camid_input", "Enter CAMID(s)", choices = c(unique(data$Collection_data$CAM_ID), unique(data$CRISPR$CAM_ID)), multiple = TRUE, options = list(placeholder = 'Enter one or more CAMIDs')),
                     actionButton("search_camid", "Search", class = "btn-primary")
              )
            ),
            uiOutput("collection_search_results"),  # Output for Collection data results
            uiOutput("crispr_search_results")       # Output for CRISPR data results
          )
  )
) 

# Server logic
server <- function(input, output, session) {
  
  # Server: Add an observer for the 'Update database' button
  observeEvent(input$update_database, {
    rawData <- Download_data()
    data <<- process_and_save_data(rawData)
  })
  
  # Add sliders to control Zoom
  output$zoom_controls <- renderUI({
    if (input$enable_zoom) {
      fluidRow(
        column(6, sliderInput("img_height", "Image Height", min = 100, max = 700, value = 300, step = 10)),
        column(6, sliderInput("img_scale", "Image Scale", min = 0.25, max = 5.0, value = 2.5, step = 0.25))
      )
    }
  })
  
  # Update selectize inputs with data
  observe({
    updateSelectizeInput(session, "taxa_family_selection", 
                         choices = c("All" = "All", unique(data$Collection_data$Family)), 
                         selected = "All")
  })
  
  # Observers for dynamically updating taxa selection inputs based on higher level selections
  observe({
    filteredData <- data$Collection_data %>%
      dplyr::filter(Family == input$taxa_family_selection | input$taxa_family_selection == "All")
    updateSelectizeInput(session, "taxa_subfamily_selection", choices = c("All" = "All", unique(filteredData$Subfamily)))
  })

  observe({
    filteredData <- data$Collection_data %>%
      dplyr::filter(Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All")
    updateSelectizeInput(session, "taxa_tribe_selection", choices = c("All" = "All", unique(filteredData$Tribe)))
  })

  observe({
    filteredData <- data$Collection_data %>%
      dplyr::filter(Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All")
    updateSelectizeInput(session, "taxa_species_selection", choices = c("All" = "All", unique(filteredData$SPECIES)))
  })

  observe({
    filteredData <- data$Collection_data %>%
      dplyr::filter(SPECIES %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection)
    updateSelectizeInput(session, "taxa_subspecies_selection", choices = c("All" = "All", unique(filteredData$Subspecies_Form)), selected = "All") 
  })
  
  createThumbnail <- function(url, alt) {
    if (input$enable_zoom) {
      div(style = paste0("overflow: hidden; width: 100%; height: ", input$img_height, "px; display: flex; justify-content: center;"), 
          img(src = url, alt = alt, style = paste0("transform: scale(", input$img_scale, ");")))
    } else {
      div(style = "flex: 1;", img(src = url, alt = alt, style = "width: 100%; height: auto; max-height: 600px; object-fit: contain;"))
    }
  }
  
  # Function to render thumbnails based on filtered data, adjusted for CRISPR data
  renderThumbnails <- function(displayId, filteredData, isCRISPR = FALSE) {
    output[[displayId]] <- renderUI({
      if (nrow(filteredData) > 0) {
        img_tags <- lapply(1:nrow(filteredData), function(i) {
          # Generate list of thumbnails based on the data context
          img_display <- if (isCRISPR && !is.null(filteredData$Photo_URLs[[i]])) {
            photos <- filteredData$Photo_URLs[[i]]
            lapply(1:nrow(photos), function(j) {
              createThumbnail(photos$URL_to_view[j], photos$Name[j])
            })
          } else { # Default handling for specific selections like Dorsal/Ventral
            switch(input$taxa_side_selection,
                   "Dorsal" = list(createThumbnail(filteredData$URLd[i], "Dorsal Side")),
                   "Ventral" = list(createThumbnail(filteredData$URLv[i], "Ventral Side")),
                   "Dorsal and Ventral" = list(
                     createThumbnail(filteredData$URLd[i], "Dorsal Side"),
                     createThumbnail(filteredData$URLv[i], "Ventral Side")
                   )
            )
          }
          
          # Create rows with no more than two thumbnails per row
          img_display_rows <- lapply(seq(1, length(img_display), by = 2), function(k) {
            div(style = "display: flex; justify-content: space-around;", # flex-wrap: wrap is optional
                img_display[k:min(k+1, length(img_display))]
            )
          })
          
          # Build tagList for display, adjusting for CRISPR or Search by Taxa Tabs
          tagList(
            h3(style = "font-weight: bold; font-size: larger;", paste("CAM ID:", filteredData$CAM_ID[i])),
            tagList(img_display_rows), # This now correctly uses the grouped rows
            if (isCRISPR) {
              fluidRow(
                column(6, p(paste("Species:", filteredData$Species[i]))),
                column(6, p(paste("Sex:", filteredData$Sex[i]))),
                column(6, p(paste("Emerge Date:", format(as.Date(filteredData$Emerge_date[i]), "%d/%b/%Y")))),
                column(6, p(paste("Mutant:", filteredData$Mutant[i])))
              )
            } else {
              fluidRow(
                column(6, p(paste("Species:", filteredData$SPECIES[i]))),
                column(6, p(paste("Subspecies/Form:", filteredData$Subspecies_Form[i]))),
                column(6, p(paste("Sex:", filteredData$Sex[i]))),
                column(6, p(paste("Preservation Date:", filteredData$Preservation_date_formatted[i])))
              )
            }
          )
        })
        do.call(tagList, img_tags)
      } else {
        "No data available for the selected criteria."
      }
    })
  }
  
  # Observe event for "Search by Taxa" action button
  observeEvent(input$taxa_show_photos, {
    filteredData <- data$Collection_data %>%
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
        filteredData %>% arrange(!!sortByColumn, CAM_ID)
      } else {
        filteredData %>% arrange(desc(!!sortByColumn), desc(CAM_ID))
      }
    }
    
    renderThumbnails("taxa_photos_display", filteredData)
    
    showNotification(paste(nrow(filteredData), "individuals found"), type = "message")
  })
  
  # Observe event for "crispr_show_photos" button
  observeEvent(input$crispr_show_photos, {
    # Filter CRISPR data based on user inputs
    filteredCRISPR <- data$CRISPR %>%
      filter(
        (input$crispr_species_selection == "All" | Species %in% input$crispr_species_selection),
        (input$crispr_sex_selection == "male and female" | Sex == input$crispr_sex_selection),
        (input$crispr_mutant_selection == "All" | Mutant == input$crispr_mutant_selection),
        !is.na(Emerge_date)
      )
    
    # Apply sorting based on user selection
    if(input$sort_by != "Row Number") {
      sortByColumn <- sym(ifelse(input$sort_by == "Preservation_date", "Emerge_date", input$sort_by))
      filteredCRISPR <- if(input$sort_order == "asc") {
        filteredCRISPR %>% arrange(!!sortByColumn, CAM_ID)
      } else {
        filteredCRISPR %>% arrange(desc(!!sortByColumn), desc(CAM_ID))
      }
    }
    
    # For each CAM_ID in filtered CRISPR, find matching entries in PhotoLinks and gather URLs and Names
    filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, function(cam_id) {
      matched_photos <- data$Photo_Links %>%
        filter(str_detect(Name, cam_id)) %>%
        select(Name, URL_to_view) # Retrieve both Name and URL_to_view
      return(matched_photos)
    })
    
    # Exclude individuals without photos
    if (input$exclude_without_photos) {
      filteredCRISPR <- filteredCRISPR[sapply(filteredCRISPR$Photo_URLs, nrow) > 0, ]
    }
    
    renderThumbnails("crispr_photos_display", filteredCRISPR, isCRISPR = TRUE)
  })
  
  # Observe event for "Search by CAMID" action button
  observeEvent(input$search_camid, {
    # Search in Collection data
    filteredCollection <- data$Collection_data %>%
      dplyr::filter(CAM_ID %in% input$camid_input)
    
    if (nrow(filteredCollection) > 0) {
      renderThumbnails("collection_search_results", filteredCollection)
    }
    
    # Search in CRISPR data
    filteredCRISPR <- data$CRISPR %>%
      dplyr::filter(CAM_ID %in% input$camid_input)
    
    if (nrow(filteredCRISPR) > 0) {
      filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, function(cam_id) {
        matched_photos <- data$Photo_Links %>%
          filter(str_detect(Name, cam_id)) %>%
          select(Name, URL_to_view) # Retrieve both Name and URL_to_view
        return(matched_photos)
      })
      
      renderThumbnails("crispr_search_results", filteredCRISPR, isCRISPR = TRUE)
    }
    
  })
}

# Run the application
shinyApp(ui = ui, server = server)
