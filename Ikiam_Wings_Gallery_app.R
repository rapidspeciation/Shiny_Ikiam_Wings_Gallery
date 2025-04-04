# Load necessary libraries
library(shiny)
library(dplyr)
library(stringr)
library(shinyWidgets)
library(readr)
library(tidyr)  # Added to use separate()
Sys.setlocale(locale = "en_US.UTF-8")  # Ensure date parsing in English

# Define constants
gsheet_id <- "1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4"
rds_paths <- list(
  Collection_data = "Collection_data.rds",
  PhotoLinks = "PhotoLinks.rds",
  CRISPR = "CRISPR.rds",
  Insectary_data = "Insectary_data.rds"
)

# Function to download data from Google Sheets and save as raw rds files
Download_and_save_raw_data <- function() {
  sheets <- c("Collection_data", "Photo_links", "CRISPR", "Insectary_data")
  data_list <- lapply(sheets, function(sheet_name) {
    url <- paste0("https://docs.google.com/spreadsheets/d/", gsheet_id, "/gviz/tq?tqx=out:csv&sheet=", URLencode(sheet_name))
    read_csv(url, col_types = cols(.default = "c"))
  })
  names(data_list) <- c("Collection_data", "PhotoLinks", "CRISPR", "Insectary_data")
  message("Data loaded from Google Sheets.")
  
  # Save raw data as rds files
  mapply(saveRDS, data_list, rds_paths)
  return(data_list)
}

# Function to process date columns
process_date_columns <- function(df) {
  date_cols <- names(df)[grepl("date", names(df), ignore.case = TRUE)]
  df %>%
    mutate(across(all_of(date_cols), ~ as.Date(., format = "%d-%b-%y")))
}

# Function to process data
process_data <- function(data) {
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
    mutate(Preservation_date_formatted = format(as.Date(Preservation_date), "%d/%b/%Y")) %>% 
    rename(Species = SPECIES)
  
  data$CRISPR <- data$CRISPR %>% process_date_columns() %>% 
    mutate(Preservation_date = Emerge_date)
  
  # Process Insectary_data
  data$Insectary_data <- data$Insectary_data %>%
    filter(CAM_ID != "" & CAM_ID != "NA") %>% 
    process_date_columns() %>%
    mutate(CAM_ID = if_else(!is.na(CAM_ID_CollData) & CAM_ID_CollData != "NA", CAM_ID_CollData, CAM_ID)) %>%
    mutate(Preservation_date_formatted = if_else(!is.na(Preservation_date), format(as.Date(Preservation_date), "%d/%b/%Y"), "NA"))
  
  # Split SPECIES into Species and Subspecies_Form
  data$Insectary_data <- data$Insectary_data %>%
    mutate(Species_full = SPECIES) %>%
    separate(SPECIES, into = c("Genus", "Species_part", "Subspecies_part"), sep = "\\s+", extra = "merge", fill = "right") %>%
    mutate(Species = paste(Genus, Species_part),
           Subspecies_Form = if_else(!is.na(Subspecies_part), Subspecies_part, "None"),
           SPECIES = Species_full) %>%
    select(-Genus, -Species_part, -Subspecies_part, -Species_full)
  
  return(data)
}

# Load or download raw data
if (!all(file.exists(unlist(rds_paths)))) {
  rawData <- Download_and_save_raw_data()
} else {
  rawData <- lapply(rds_paths, readRDS)
  names(rawData) <- names(rds_paths)
}

# Process the data
data <- process_data(rawData)

# Helper function to get photo URLs
get_photo_urls <- function(cam_id) {
  data$PhotoLinks %>% 
    filter(str_detect(Name, cam_id) & !str_detect(Name, "(ORF|CR2)$")) %>% 
    select(Name, URL_to_view)
}

# UI components
ui <- navbarPage(
  title = "Ikiam Wings Gallery",
  header = fluidPage(
    tags$head(
      # Include the Panzoom library from CDN
      tags$script(src = "https://unpkg.com/@panzoom/panzoom@4.6.0/dist/panzoom.min.js")
    ),
    fluidRow(
      column(3, 
             selectInput("sort_by", "Sort By", 
                         choices = c("Row Number", "CAM_ID", "Preservation_date"), 
                         selected = "Preservation_date")),
      column(3, 
             selectInput("sort_order", "Sort Order", 
                         choices = c("Ascending" = "asc", "Descending" = "desc"), 
                         selected = "desc")),
      column(3, 
             selectInput("side_selection", "Select Side", 
                         choices = c("Dorsal", "Ventral", "Dorsal and Ventral"), 
                         selected = "Dorsal and Ventral")),
      column(3, 
             checkboxInput("exclude_without_photos", "Only Indiv. With Photos", TRUE),
             checkboxInput("one_per_subspecies_sex", "One Per Subspecies/Sex", FALSE))
    ),
    fluidRow(
      column(9, 
             wellPanel(
               style = "background-color: #f9f9f9; padding: 5px 5px; border: 1px solid #ccc; border-radius: 5px;",
               p(HTML("Navigation: Shift + Scroll = Zoom all photos | Ctrl + Scroll = Zoom one photo | Click & Drag = Move one photo | Shift + Arrow Keys = Move all photos<br>Github: <a href='https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/' target='_blank'>rapidspeciation/Shiny_Ikiam_Wings_Gallery</a>"), 
                 style = "font-size: 16px; text-align: center;")
             ),
             align = "center"),
      column(3, 
             actionButton("reset_zoom", "Reset Zoom", style = 'background-color:#D3D3D3'))
    )
  ),
  
  # Reordered and renamed tabs
  tabPanel("Collection",
           fluidPage(
             fluidRow(
               column(3, 
                      selectizeInput("taxa_family_selection", "Select Family", 
                                     choices = NULL, 
                                     selected = "All", 
                                     options = list(placeholder = 'Choose a family'))),
               column(3, 
                      selectizeInput("taxa_subfamily_selection", "Select Subfamily", 
                                     choices = NULL, 
                                     selected = "All", 
                                     options = list(placeholder = 'Choose a subfamily'))),
               column(3, 
                      selectizeInput("taxa_tribe_selection", "Select Tribe", 
                                     choices = NULL, 
                                     selected = "All", 
                                     options = list(placeholder = 'Choose a tribe'))),
               column(3, 
                      selectizeInput("taxa_species_selection", "Select Species", 
                                     choices = NULL, 
                                     multiple = TRUE, 
                                     options = list(placeholder = 'Choose species')))
             ),
             fluidRow(
               column(3, 
                      selectizeInput("taxa_subspecies_selection", "Select Subspecies", 
                                     choices = NULL, 
                                     selected = "All", 
                                     multiple = TRUE, 
                                     options = list(placeholder = 'Choose subspecies'))),
               column(3, 
                      selectInput("taxa_sex_selection", "Select Sex", 
                                  choices = c("male", "female", "male and female"), 
                                  selected = "male and female"))
             ),
             fluidRow(
               column(3, 
                      actionButton("taxa_show_photos", "Show Photos", class = "btn-primary"))
             ),
             uiOutput("taxa_photos_display")
           )
  ),
  
  tabPanel("Insectary",
           fluidPage(
             fluidRow(
               column(3,
                      selectizeInput("insectary_species_selection", "Select Species",
                                     choices = NULL,
                                     multiple = TRUE, 
                                     options = list(placeholder = 'Choose a species'))),
               column(3,
                      selectizeInput("insectary_subspecies_selection", "Select Subspecies",
                                     choices = NULL,
                                     multiple = TRUE, 
                                     selected = "All",
                                     options = list(placeholder = 'Choose a subspecies'))),
               column(3,
                      selectInput("insectary_sex_selection", "Select Sex",
                                  choices = c("male", "female", "male and female"),
                                  selected = "male and female")),
               column(3,
                      selectizeInput("insectary_id_selection", "Select Insectary ID",
                                     choices = NULL,
                                     selected = "All",
                                     options = list(placeholder = 'Choose an ID')))
             ),
             fluidRow(
               column(12,
                      actionButton("insectary_show_photos", "Show Photos", class = "btn-primary"))
             ),
             uiOutput("insectary_photos_display")
           )
  ),
  
  tabPanel("CRISPR",
           fluidPage(
             fluidRow(
               column(3, 
                      selectizeInput("crispr_species_selection", "Select Species", 
                                     choices = NULL, 
                                     selected = "All", 
                                     multiple = TRUE, 
                                     options = list(placeholder = 'Choose a species'))),
               column(3, 
                      selectInput("crispr_sex_selection", "Select Sex", 
                                  choices = c("male", "female", "male and female"), 
                                  selected = "male and female")),
               column(3, 
                      selectInput("crispr_mutant_selection", "Mutant", 
                                  choices = c("Yes", "No", "Check", "All"), 
                                  selected = "All"))
             ),
             fluidRow(
               column(12, 
                      actionButton("crispr_show_photos", "Show Photos", class = "btn-primary"))
             ),
             uiOutput("crispr_photos_display")
           )
  ),
  
  tabPanel("Search by CAMID",
           fluidPage(
             fluidRow(
               column(12,
                      textAreaInput("camid_input", "Enter CAMID(s)", 
                                    placeholder = 'Enter one or more CAMIDs, separated by new lines or spaces'),
                      actionButton("search_camid", "Search", class = "btn-primary")
               )
             ),
             uiOutput("collection_search_results"),
             uiOutput("crispr_search_results"),
             uiOutput("insectary_search_results")
           )
  ),
  # Adding the Update Database button as a tabPanel
  tabPanel(
    title = HTML("<button id='update_db_btn' class='btn btn-primary' style='background-color: #262626; border: none; margin: -8px; color: white;'>Update Database</button>"),
    value = "update"
  )
)

# Server logic
server <- function(input, output, session) {
  
  # Update database button
  observeEvent(input$update_database, {
    rawData <- Download_and_save_raw_data()
    data <<- process_data(rawData)
  })
  
  # Prevent Update database button to act as a tab
  insertUI(selector = "head", where = "beforeEnd", 
    ui = tags$script("$(document).on('click', '#update_db_btn', function(e) {
      e.preventDefault();
      Shiny.setInputValue('update_database', true, {priority: 'event'});
      return false;
    });
  ")
  )
  
  # Function to create thumbnails (always with Panzoom)
  createThumbnail <- function(url, alt) {
    img_tag <- img(src = url, alt = alt, class = "panzoom", style = "max-width: 100%; height: auto;")
    div_tag <- div(style = "overflow: hidden; width: 100%; height: auto; display: flex; justify-content: center;", img_tag)
    return(div_tag)
  }
  
  # Function to render thumbnails
  renderThumbnails <- function(displayId, filteredData, data_source, side_selection = "Dorsal and Ventral") {
    output[[displayId]] <- renderUI({
      if (nrow(filteredData) > 0) {
        img_tags <- lapply(1:nrow(filteredData), function(i) {
          # Generate image displays based on data_source
          if (data_source %in% c("CRISPR", "Insectary") && !is.null(filteredData$Photo_URLs[[i]])) {
            photos <- filteredData$Photo_URLs[[i]]
            # Filter photos based on side_selection
            if (side_selection == "Dorsal") {
              photos <- photos[grepl("d", photos$Name, ignore.case = TRUE), ]
            } else if (side_selection == "Ventral") {
              photos <- photos[grepl("v", photos$Name, ignore.case = TRUE), ]
            }
            if (nrow(photos)>0) {
              img_display <- lapply(1:nrow(photos), function(j) {
                createThumbnail(photos$URL_to_view[j], photos$Name[j])
              })
            }
          } else {
            img_display <- switch(side_selection,
                                  "Dorsal" = list(createThumbnail(filteredData$URLd[i], "Dorsal Side")),
                                  "Ventral" = list(createThumbnail(filteredData$URLv[i], "Ventral Side")),
                                  "Dorsal and Ventral" = list(
                                    createThumbnail(filteredData$URLd[i], "Dorsal Side"),
                                    createThumbnail(filteredData$URLv[i], "Ventral Side")
                                  ))
          }
          
          # Arrange images in rows
          img_display_rows <- lapply(seq(1, length(img_display), by = 2), function(k) {
            div(style = "display: flex; justify-content: space-around;",
                img_display[k:min(k+1, length(img_display))]
            )
          })
          
          # Adjust info_tags based on data_source
          info_tags <- switch(data_source,
                              "Collection" = fluidRow(
                                column(6, p(paste("Species:", filteredData$Species[i]))),
                                column(6, p(paste("Subspecies/Form:", filteredData$Subspecies_Form[i]))),
                                column(6, p(paste("Sex:", filteredData$Sex[i]))),
                                column(6, p(paste("Preservation Date:", filteredData$Preservation_date_formatted[i])))
                              ),
                              "CRISPR" = fluidRow(
                                column(6, p(paste("Species:", filteredData$Species[i]))),
                                column(6, p(paste("Sex:", filteredData$Sex[i]))),
                                column(6, p(paste("Emerge Date:", format(as.Date(filteredData$Emerge_date[i]), "%d/%b/%Y")))),
                                column(6, p(paste("Mutant:", filteredData$Mutant[i])))
                              ),
                              "Insectary" = fluidRow(
                                column(6, p(paste("Species:", filteredData$Species[i]))),
                                column(6, p(paste("Subspecies/Form:", filteredData$Subspecies_Form[i]))),
                                column(6, p(paste("Sex:", filteredData$Sex[i]))),
                                column(6, p(paste("Insectary ID:", filteredData$Insectary_ID[i])))
                              ),
                              fluidRow()
          )
          
          tagList(
            h3(style = "font-weight: bold; font-size: larger;", paste("CAM ID:", filteredData$CAM_ID[i])),
            tagList(img_display_rows),
            info_tags
          )
        })
        
        # Include the JavaScript code
        js_code <- '
          setTimeout(function() {
            // Destroy existing Panzoom instances if any
            if (window.panzoomInstances) {
              window.panzoomInstances.forEach(function(instance) {
                instance.destroy();
              });
            }
            window.panzoomInstances = [];
            var panzoomElements = document.querySelectorAll(".panzoom");
            
            panzoomElements.forEach(function(elem) {
              var panzoomInstance = Panzoom(elem, { maxScale: 5 });
              window.panzoomInstances.push(panzoomInstance);
              
              // Add Ctrl + Wheel zooming for individual images
              elem.parentElement.addEventListener("wheel", function(event) {
                if (!event.ctrlKey) return;
                event.preventDefault();
                var scale = panzoomInstance.getScale();
                var deltaScale = event.deltaY < 0 ? scale * 1.1 : scale * 0.9;
                panzoomInstance.zoom(deltaScale, { animate: false });
              });
            });
            
            // Add Shift + Wheel zooming that zooms all images
            document.addEventListener("wheel", function(event) {
              if (!event.shiftKey) return;
              event.preventDefault();
              // Use deltaY or deltaX (whichever has a larger absolute value)
              var delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
              var deltaScale = delta < 0 ? 1.1 : 0.9;
              window.panzoomInstances.forEach(function(panzoomInstance) {
                var scale = panzoomInstance.getScale();
                panzoomInstance.zoom(scale * deltaScale, { animate: false });
              });
            });
            
            // Add keyboard arrow key support with shift key - highly optimized
            document.addEventListener("keydown", function(event) {
              if (!event.shiftKey || !window.panzoomInstances?.length) return;
              
              const moveAmount = 5;
              const moves = {
                ArrowUp: [0, -moveAmount],
                ArrowDown: [0, moveAmount],
                ArrowLeft: [-moveAmount, 0],
                ArrowRight: [moveAmount, 0]
              };
              
              const direction = moves[event.key];
              if (!direction) return;
              
              event.preventDefault();
              window.panzoomInstances.forEach(instance => {
                const {x, y} = instance.getPan();
                instance.pan(x + direction[0], y + direction[1], {animate: false});
              });
            });
            
            // Get the reset button
            var resetButton = document.getElementById("reset_zoom");
            
            // Remove existing event listeners to prevent duplicates
            resetButton.replaceWith(resetButton.cloneNode(true));
            
            resetButton = document.getElementById("reset_zoom");
            
            // Add event listener for Reset Zoom button
            resetButton.addEventListener("click", function() {
              window.panzoomInstances.forEach(function(panzoomInstance) {
                panzoomInstance.reset({ animate: false });
              });
            });
            
          }, 500); // Adjust the delay if necessary
        '
        
        img_tags <- c(img_tags, list(tags$script(HTML(js_code))))
        
        do.call(tagList, img_tags)
      } else {
        "No data available for the selected criteria."
      }
    })
  }
  
  # Function to update selectize inputs
  update_selectize <- function(inputId, choices, default_selected = 'All', server = FALSE) {
    updateSelectizeInput(session, inputId, choices = c("All" = "All", sort(unique(choices))), selected = default_selected, server = server)
  }
  
  # Reactive expressions for taxa selection
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
    update_selectize("taxa_species_selection", filteredData$Species, default_selected = NULL)
  })
  
  observeEvent(input$taxa_species_selection, {
    filteredData <- data$Collection_data %>%
      filter(Species %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection)
    update_selectize("taxa_subspecies_selection", filteredData$Subspecies_Form)
  })
  
  # Observe event for "Search by Taxa"
  observeEvent(input$taxa_show_photos, {
    filteredData <- data$Collection_data %>%
      filter(
        (Family == input$taxa_family_selection | input$taxa_family_selection == "All"),
        (Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All"),
        (Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All"),
        (Species %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection),
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
    
    renderThumbnails("taxa_photos_display", filteredData, data_source = "Collection", side_selection = input$side_selection)
    showNotification(paste(nrow(filteredData), "individuals found"), type = "message")
  })
  
  # Observe event for "CRISPR" tab
  observe({
    updateSelectizeInput(session, "crispr_species_selection", 
                         choices = c("All", unique(data$CRISPR$Species)), 
                         selected = "All")
  })
  
  observeEvent(input$crispr_show_photos, {
    filteredCRISPR <- data$CRISPR %>%
      filter(
        (Species %in% input$crispr_species_selection | input$crispr_species_selection == "All"),
        (Sex == input$crispr_sex_selection | input$crispr_sex_selection == "male and female"),
        (Mutant == input$crispr_mutant_selection | input$crispr_mutant_selection == "All"),
        !is.na(Emerge_date)
      )
    
    filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, get_photo_urls)
    
    if (input$exclude_without_photos) {
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
    
    renderThumbnails("crispr_photos_display", filteredCRISPR, data_source = "CRISPR", side_selection = input$side_selection)
  })
  
  # Observe event for "Search by CAMID"
  observeEvent(input$search_camid, {
    # Split the input CAMID list into individual CAMIDs (splitting by comma, space, newline)
    camids <- str_split(input$camid_input, "[,\\s]+")[[1]]  # Split by any commas, spaces, or newlines
    camids <- camids[camids != ""]  # Remove empty entries
    
    # Filter the Collection data based on valid CAMIDs
    filteredCollection <- data$Collection_data %>% filter(CAM_ID %in% camids)
    if (nrow(filteredCollection) > 0) {
      renderThumbnails("collection_search_results", filteredCollection, data_source = "Collection", side_selection = input$side_selection)
    } else {
      output$collection_search_results <- renderUI({
        "No valid CAMIDs found in the Collection data."
      })
    }
    
    # Filter the CRISPR data based on valid CAMIDs
    filteredCRISPR <- data$CRISPR %>% filter(CAM_ID %in% camids)
    if (nrow(filteredCRISPR) > 0) {
      filteredCRISPR$Photo_URLs <- lapply(filteredCRISPR$CAM_ID, get_photo_urls)
      renderThumbnails("crispr_search_results", filteredCRISPR, data_source = "CRISPR", side_selection = input$side_selection)
    } else {
      output$crispr_search_results <- renderUI({
        "No valid CAMIDs found in the CRISPR data."
      })
    }
    
    # Filter the Insectary data based on valid CAMIDs
    filteredInsectary <- data$Insectary_data %>% filter(CAM_ID %in% camids)
    if (nrow(filteredInsectary) > 0) {
      filteredInsectary$Photo_URLs <- lapply(filteredInsectary$CAM_ID, get_photo_urls)
      renderThumbnails("insectary_search_results", filteredInsectary, data_source = "Insectary", side_selection = input$side_selection)
    } else {
      output$insectary_search_results <- renderUI({
        "No valid CAMIDs found in the Insectary data."
      })
    }
  })
  
  # Insectary Gallery tab
  observe({
    update_selectize("insectary_species_selection",
                     choices = data$Insectary_data$Species)
  })
  
  observeEvent(input$insectary_species_selection, {
    filteredData <- data$Insectary_data %>%
      filter(Species == input$insectary_species_selection | input$insectary_species_selection == "All")
    update_selectize("insectary_subspecies_selection",
                     choices = filteredData$Subspecies_Form)
    update_selectize("insectary_id_selection",
                     choices = filteredData$Insectary_ID, server = TRUE)
  })
  
  observeEvent(input$insectary_show_photos, {
    filteredData <- data$Insectary_data %>%
      filter(
        (Species == input$insectary_species_selection | input$insectary_species_selection == "All"),
        (Subspecies_Form == input$insectary_subspecies_selection | input$insectary_subspecies_selection == "All"),
        (Sex == input$insectary_sex_selection | input$insectary_sex_selection == "male and female"),
        (Insectary_ID == input$insectary_id_selection | input$insectary_id_selection == "All")
      )
    
    if (input$exclude_without_photos) {
      filteredData$Photo_URLs <- lapply(filteredData$CAM_ID, get_photo_urls)
      filteredData <- filteredData[sapply(filteredData$Photo_URLs, nrow) > 0, ]
    } else {
      filteredData$Photo_URLs <- lapply(filteredData$CAM_ID, get_photo_urls)
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
    
    renderThumbnails("insectary_photos_display", filteredData, data_source = "Insectary", side_selection = input$side_selection)
    showNotification(paste(nrow(filteredData), "individuals found"), type = "message")
  })
}

# Run the application
shinyApp(ui = ui, server = server)