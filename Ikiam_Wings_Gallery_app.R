library(shiny)
library(dplyr)
library(readxl)
library(stringr)
library(shinyWidgets)
library(googlesheets4)
gs4_deauth()  # No need for Google authentication
Sys.setlocale(locale = "en_US.UTF-8")  # Ensure date parsing in English

# Define constants
gsheet_id <- "1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4"
rsd_paths <- list(
  Collection_data = "Coll_data.rsd",
  PhotoLinks = "PhotoLinks.rsd",
  CRISPR = "CRISPR.rsd"
)

# Function to download data from Google Sheets
Download_data <- function() {
  sheets <- c("Collection_data", "Photo_links", "CRISPR")
  data_list <- lapply(sheets, function(sheet_name) {
    read_sheet(gsheet_id, sheet = sheet_name, col_types = "c")
  })
  names(data_list) <- c("Collection_data", "PhotoLinks", "CRISPR")
  message("Data loaded from Google Sheets.")
  return(data_list)
}

# Function to process date columns
process_date_columns <- function(df) {
  date_cols <- names(df)[grepl("date", names(df), ignore.case = TRUE)]
  df %>%
    mutate(across(all_of(date_cols), ~ as.Date(., format = "%d-%b-%y")))
}

# Function to process and save data
process_and_save_data <- function(data) {
  data$PhotoLinks <- data$PhotoLinks %>%
    mutate(URL_to_view = gsub("https://drive.google.com/file/d/(.*)/view\\?usp=drivesdk",
                              "https://drive.google.com/thumbnail?id=\\1&sz=w2000", URL),
           CAM_ID = str_extract(Name, ".*(?=[dv]\\.JPG)"))
  
  # Create Dorsal and Ventral links
  create_links <- function(side) {
    data$PhotoLinks %>%
      filter(str_detect(Name, paste0(side, "\\.JPG"))) %>%
      select(CAM_ID, URL = URL_to_view) %>%
      rename_with(~ paste0("URL", side), "URL")
  }
  
  Dorsal_links <- create_links("d")
  Ventral_links <- create_links("v")
  
  data$Collection_data <- data$Collection_data %>%
    process_date_columns() %>%
    mutate(CAM_ID = if_else(!is.na(CAM_ID_insectary) & CAM_ID_insectary != "NA", CAM_ID_insectary, CAM_ID)) %>%
    left_join(Dorsal_links, by = "CAM_ID") %>%
    left_join(Ventral_links, by = "CAM_ID") %>%
    mutate(Preservation_date_formatted = format(as.Date(Preservation_date), "%d/%b/%Y"))
  
  data$CRISPR <- data$CRISPR %>% process_date_columns()
  
  # Save processed data
  saveRDS(data$Collection_data, rsd_paths$Collection_data)
  saveRDS(data$CRISPR, rsd_paths$CRISPR)
  saveRDS(data$PhotoLinks, rsd_paths$PhotoLinks)  # Optional
  
  return(data)
}

# Load or download data
if (!file.exists(rsd_paths$Collection_data) || !file.exists(rsd_paths$CRISPR)) {
  rawData <- Download_data()
  data <- process_and_save_data(rawData)
} else {
  data <- list(
    Collection_data = readRDS(rsd_paths$Collection_data),
    PhotoLinks = readRDS(rsd_paths$PhotoLinks),
    CRISPR = readRDS(rsd_paths$CRISPR)
  )
}

# UI components
ui <- navbarPage(
  title = "Ikiam Wings Gallery",
  header = fluidPage(
    fluidRow(
      column(3, actionButton("update_database", "Update Database", class = "btn-primary", style = "background-color: #262626; height: 50%"), align = "center"),
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
               column(3, selectizeInput("taxa_family_selection", "Select Family", choices = NULL, selected = "All", options = list(placeholder = 'Choose a family'))),
               column(3, selectizeInput("taxa_subfamily_selection", "Select Subfamily", choices = NULL, selected = "All", options = list(placeholder = 'Choose a subfamily'))),
               column(3, selectizeInput("taxa_tribe_selection", "Select Tribe", choices = NULL, selected = "All", options = list(placeholder = 'Choose a tribe'))),
               column(3, selectizeInput("taxa_species_selection", "Select Species", choices = NULL, multiple = TRUE, options = list(placeholder = 'Choose species')))
             ),
             fluidRow(
               column(3, selectizeInput("taxa_subspecies_selection", "Select Subspecies", choices = NULL, selected = "All", multiple = TRUE, options = list(placeholder = 'Choose subspecies'))),
               column(3, selectInput("taxa_sex_selection", "Select Sex", choices = c("male", "female", "male and female"), selected = "male and female")),
               column(3, selectInput("taxa_side_selection", "Select Side", choices = c("Dorsal", "Ventral", "Dorsal and Ventral"), selected = "Dorsal and Ventral")),
               column(3, checkboxInput("one_per_subspecies_sex", "One Per Subspecies/Sex", FALSE))
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
               column(3, selectizeInput("crispr_species_selection", "Select Species", choices = NULL, selected = "All", multiple = TRUE, options = list(placeholder = 'Choose a species'))),
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
                      textAreaInput("camid_input", "Enter CAMID(s)", placeholder = 'Enter one or more CAMIDs, separated by new lines or spaces'),
                      actionButton("search_camid", "Search", class = "btn-primary")
               )
             ),
             uiOutput("collection_search_results"),
             uiOutput("crispr_search_results")
           )
  )
)

# Server logic
server <- function(input, output, session) {
  
  # Update database button
  observeEvent(input$update_database, {
    rawData <- Download_data()
    data <<- process_and_save_data(rawData)
  })
  
  # Zoom controls
  output$zoom_controls <- renderUI({
    if (input$enable_zoom) {
      fluidRow(
        column(6, sliderInput("img_height", "Image Height", min = 100, max = 700, value = 300, step = 10)),
        column(6, sliderInput("img_scale", "Image Scale", min = 0.25, max = 5.0, value = 2.5, step = 0.25))
      )
    }
  })
  
  # Function to create thumbnails
  createThumbnail <- function(url, alt) {
    if (input$enable_zoom) {
      div(style = paste0("overflow: hidden; width: 100%; height: ", input$img_height, "px; display: flex; justify-content: center;"), 
          img(src = url, alt = alt, style = paste0("transform: scale(", input$img_scale, ");")))
    } else {
      div(style = "flex: 1;", img(src = url, alt = alt, style = "width: 100%; height: auto; max-height: 600px; object-fit: contain;"))
    }
  }
  
  # Function to render thumbnails
  renderThumbnails <- function(displayId, filteredData, isCRISPR = FALSE) {
    output[[displayId]] <- renderUI({
      if (nrow(filteredData) > 0) {
        img_tags <- lapply(1:nrow(filteredData), function(i) {
          img_display <- if (isCRISPR && !is.null(filteredData$Photo_URLs[[i]])) {
            photos <- filteredData$Photo_URLs[[i]]
            lapply(1:nrow(photos), function(j) {
              createThumbnail(photos$URL_to_view[j], photos$Name[j])
            })
          } else {
            side_selection <- switch(input$taxa_side_selection,
                                     "Dorsal" = list(createThumbnail(filteredData$URLd[i], "Dorsal Side")),
                                     "Ventral" = list(createThumbnail(filteredData$URLv[i], "Ventral Side")),
                                     "Dorsal and Ventral" = list(
                                       createThumbnail(filteredData$URLd[i], "Dorsal Side"),
                                       createThumbnail(filteredData$URLv[i], "Ventral Side")
                                     ))
          }
          
          img_display_rows <- lapply(seq(1, length(img_display), by = 2), function(k) {
            div(style = "display: flex; justify-content: space-around;",
                img_display[k:min(k+1, length(img_display))]
            )
          })
          
          info_tags <- if (isCRISPR) {
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
          
          tagList(
            h3(style = "font-weight: bold; font-size: larger;", paste("CAM ID:", filteredData$CAM_ID[i])),
            tagList(img_display_rows),
            info_tags
          )
        })
        do.call(tagList, img_tags)
      } else {
        "No data available for the selected criteria."
      }
    })
  }
  
  # Reactive expressions for taxa selection
  update_selectize <- function(inputId, choices, default_selected = 'All') {
    updateSelectizeInput(session, inputId, choices = c("All" = "All", sort(unique(choices))), selected = default_selected)
  }
  
  observe({
    update_selectize("taxa_family_selection", data$Collection_data$Family)
  })
  
  observeEvent(input$taxa_family_selection, {
    filteredData <- data$Collection_data %>%
      filter(Family == input$taxa_family_selection | input$taxa_family_selection == "All")
    update_selectize("taxa_subfamily_selection", filteredData$Subfamily)
  })
  
  observeEvent(input$taxa_subfamily_selection, {
    filteredData <- data$Collection_data %>%
      filter(Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All")
    update_selectize("taxa_tribe_selection", filteredData$Tribe)
  })
  
  observeEvent(input$taxa_tribe_selection, {
    filteredData <- data$Collection_data %>%
      filter(Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All")
    update_selectize("taxa_species_selection", filteredData$SPECIES, default_selected = NULL)
  })
  
  observeEvent(input$taxa_species_selection, {
    filteredData <- data$Collection_data %>%
      filter(SPECIES %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection)
    update_selectize("taxa_subspecies_selection", filteredData$Subspecies_Form)
  })
  
  # Observe event for "Search by Taxa"
  observeEvent(input$taxa_show_photos, {
    filteredData <- data$Collection_data %>%
      filter(
        (Family == input$taxa_family_selection | input$taxa_family_selection == "All"),
        (Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All"),
        (Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All"),
        (SPECIES %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection),
        (Subspecies_Form %in% input$taxa_subspecies_selection | "All" %in% input$taxa_subspecies_selection),
        (Sex == input$taxa_sex_selection | input$taxa_sex_selection == "male and female")
      )
    
    if (input$exclude_without_photos) {
      filteredData <- filteredData %>% filter(!is.na(URLd) | !is.na(URLv))
    }
    
    if (input$one_per_subspecies_sex) {
      filteredData <- filteredData %>% group_by(Subspecies_Form, Sex) %>% slice(1) %>% ungroup()
    }
    
    # Apply sorting
    if (input$sort_by != "Row Number") {
      sortByColumn <- sym(input$sort_by)
      filteredData <- if (input$sort_order == "asc") {
        filteredData %>% arrange(!!sortByColumn, CAM_ID)
      } else {
        filteredData %>% arrange(desc(!!sortByColumn), desc(CAM_ID))
      }
    }
    
    renderThumbnails("taxa_photos_display", filteredData)
    showNotification(paste(nrow(filteredData), "individuals found"), type = "message")
  })
  
  # Observe event for "CRISPR" tab
  observe({
    updateSelectizeInput(session, "crispr_species_selection", choices = c("All", unique(data$CRISPR$Species)), selected = "All")
  })
  
  observeEvent(input$crispr_show_photos, {
    filteredCRISPR <- data$CRISPR %>%
      filter(
        (input$crispr_species_selection == "All" | Species %in% input$crispr_species_selection),
        (input$crispr_sex_selection == "male and female" | Sex == input$crispr_sex_selection),
        (input$crispr_mutant_selection == "All" | Mutant == input$crispr_mutant_selection),
        !is.na(Emerge_date)
      )
    
    if (input$exclude_without_photos) {
      filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, function(cam_id) {
        data$PhotoLinks %>% filter(str_detect(Name, cam_id)) %>% select(Name, URL_to_view)
      })
      filteredCRISPR <- filteredCRISPR[sapply(filteredCRISPR$Photo_URLs, nrow) > 0, ]
    }
    
    # Apply sorting
    if (input$sort_by != "Row Number") {
      sortByColumn <- sym(ifelse(input$sort_by == "Preservation_date", "Emerge_date", input$sort_by))
      filteredCRISPR <- if (input$sort_order == "asc") {
        filteredCRISPR %>% arrange(!!sortByColumn, CAM_ID)
      } else {
        filteredCRISPR %>% arrange(desc(!!sortByColumn), desc(CAM_ID))
      }
    }
    
    filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, function(cam_id) {
      data$PhotoLinks %>% filter(str_detect(Name, cam_id)) %>% select(Name, URL_to_view)
    })
    
    renderThumbnails("crispr_photos_display", filteredCRISPR, isCRISPR = TRUE)
  })
  
  # Observe event for "Search by CAMID"
  observeEvent(input$search_camid, {
    # Split the input CAMID list into individual CAMIDs (splitting by comma, space, newline)
    camids <- str_split(input$camid_input, "[,\\s]+")[[1]]  # Split by any commas, spaces, or newlines
    camids <- camids[camids != ""]  # Remove empty entries
    
    # Check if entered CAMIDs are valid
    valid_camids <- camids[camids %in% c(data$Collection_data$CAM_ID, data$CRISPR$CAM_ID)]
    invalid_camids <- setdiff(camids, valid_camids)
    
    if (length(invalid_camids) > 0) {
      showNotification(paste("Invalid CAMIDs: ", paste(invalid_camids, collapse = ", ")), type = "error")
    }
    
    # Filter the Collection data based on valid CAMIDs
    filteredCollection <- data$Collection_data %>% filter(CAM_ID %in% valid_camids)
    if (nrow(filteredCollection) > 0) {
      renderThumbnails("collection_search_results", filteredCollection)
    } else {
      output$collection_search_results <- renderUI({
        "No valid CAMIDs found in the Collection data."
      })
    }
    
    # Filter the CRISPR data based on valid CAMIDs
    filteredCRISPR <- data$CRISPR %>% filter(CAM_ID %in% valid_camids)
    if (nrow(filteredCRISPR) > 0) {
      filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, function(cam_id) {
        data$PhotoLinks %>% filter(str_detect(Name, cam_id)) %>% select(Name, URL_to_view)
      })
      renderThumbnails("crispr_search_results", filteredCRISPR, isCRISPR = TRUE)
    } else {
      output$crispr_search_results <- renderUI({
        "No valid CAMIDs found in the CRISPR data."
      })
    }
  })
}

# Run the application
shinyApp(ui = ui, server = server)
