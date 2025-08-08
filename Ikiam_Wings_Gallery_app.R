# Load necessary libraries
library(shiny)
library(dplyr)
library(stringr)
library(shinyWidgets)
library(readr)
library(tidyr)  # Added to use separate()
Sys.setlocale(locale = "en_US.UTF-8")  # Ensure date parsing in English

# Source the download function and its constants
source("download_data.R")

# Function to process date columns
process_date_columns <- function(df) {
  date_cols <- names(df)[grepl("date", names(df), ignore.case = TRUE)]
  df %>%
    mutate(across(all_of(date_cols), ~ as.Date(., format = "%d-%b-%y")))
}

# Function to process data
process_data <- function(data) {
  data$Photo_links <- data$Photo_links %>%
    mutate(URL_to_view = gsub("https://drive.google.com/file/d/(.*)/view\\?usp=drivesdk",
                              "https://drive.google.com/thumbnail?id=\\1&sz=w2000", URL),
           CAM_ID = str_extract(Name, ".*(?=[dv]\\.JPG)"))
  
  # Create Dorsal and Ventral links
  create_links <- function(side) {
    data$Photo_links %>%
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
    rename(Species = SPECIES) %>%
    mutate(ID_status = if_else(is.na(ID_status), "NA", ID_status))
  
  data$CRISPR <- data$CRISPR %>% process_date_columns() %>% 
    mutate(Preservation_date = Emerge_date) %>% 
    mutate(Mutant = if_else(is.na(Mutant), "NA", Mutant))
  
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
  rawData <- download_and_save_data(show_toasts = FALSE)
} else {
  rawData <- lapply(rds_paths, readRDS)
  names(rawData) <- names(rds_paths)
}

# Process the data
data <- process_data(rawData)

# Helper function to get photo URLs
get_photo_urls <- function(cam_id) {
  data$Photo_links %>% 
    filter(str_detect(Name, cam_id) & !str_detect(Name, regex("(ORF|CR2)$", ignore_case = TRUE))) %>% 
    select(Name, URL_to_view)
}

# UI components
ui <- navbarPage(
  title = "Ikiam Wings Gallery",
  header = fluidPage(
    tags$head(
      # Include the Panzoom library from CDN
      tags$script(src = "https://unpkg.com/@panzoom/panzoom@4.6.0/dist/panzoom.min.js"),
      # Modify disconnect overlay to show border
      tags$style(type = "text/css",
        "#shiny-disconnected-overlay {
          opacity: 1 !important;
          background-color: transparent !important;
          border: 5px solid red !important;
        }"
      )
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
                                  selected = "male and female")),
               column(3,
                      selectizeInput("taxa_id_status_selection", "Select ID Status",
                                    choices = NULL,
                                    multiple = TRUE,
                                    selected = "All",
                                    options = list(placeholder = 'Choose ID status')))
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
                                  choices = c("Yes", "No", "Check", "All", "NA"), 
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
  
  # Helper variables for pagination
  display_row_index <- list()   # rows already rendered per displayId
  data_cache        <- list()   # complete filtered data per displayId
  side_sel_cache    <- list()   # side‑selection ("Dorsal / Ventral …") per displayId
  observer_created  <- list()   # flag so the "load‑more" observer is registered once
  
  # Update database button
  observeEvent(input$update_database, {
    rawData <- download_and_save_data(show_toasts = TRUE)
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
  renderThumbnails <- function(displayId, filteredData, data_source,
                             side_selection = "Dorsal and Ventral", reset = TRUE) {
    
    ## cache data & settings
    data_cache[[displayId]]     <<- filteredData
    side_sel_cache[[displayId]] <<- side_selection
    if (reset || is.null(display_row_index[[displayId]]))
      display_row_index[[displayId]] <<- 0
    
    ## slice the next block of ≤200 rows
    end_row   <- min(display_row_index[[displayId]] + 200, nrow(filteredData))
    subsetData <- filteredData[seq_len(end_row), , drop = FALSE]
    display_row_index[[displayId]] <<- end_row
    
    ## ----------‑‑‑‑‑‑‑‑‑‑‑‑ ORIGINAL BODY, but use subsetData  ‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑ ##
    output[[displayId]] <- renderUI({
      if (nrow(subsetData) == 0) return("No data available for the selected criteria.")
      
      # Add the count message before the images
      count_message <- div(
        style = "text-align: center; font-size: 18px; margin-bottom: 20px; font-weight: bold;",
        paste(nrow(filteredData), "individuals found", 
              if (end_row < nrow(filteredData)) paste0("(", end_row, " shown)") else "")
      )
      
      img_tags <- lapply(seq_len(nrow(subsetData)), function(i) {
        # Generate image displays based on data_source
        if (data_source %in% c("CRISPR", "Insectary") && !is.null(subsetData$Photo_URLs[[i]])) {
          photos <- subsetData$Photo_URLs[[i]]
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
                                "Dorsal" = list(createThumbnail(subsetData$URLd[i], "Dorsal Side")),
                                "Ventral" = list(createThumbnail(subsetData$URLv[i], "Ventral Side")),
                                "Dorsal and Ventral" = list(
                                  createThumbnail(subsetData$URLd[i], "Dorsal Side"),
                                  createThumbnail(subsetData$URLv[i], "Ventral Side")
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
                              column(6, p(paste("Species:", subsetData$Species[i]))),
                              column(6, p(paste("Subspecies/Form:", subsetData$Subspecies_Form[i]))),
                              column(6, p(paste("Sex:", subsetData$Sex[i]))),
                              column(6, p(paste("Preservation Date:", subsetData$Preservation_date_formatted[i])))
                            ),
                            "CRISPR" = fluidRow(
                              column(6, p(paste("Species:", subsetData$Species[i]))),
                              column(6, p(paste("Sex:", subsetData$Sex[i]))),
                              column(6, p(paste("Emerge Date:", format(as.Date(subsetData$Emerge_date[i]), "%d/%b/%Y")))),
                              column(6, p(paste("Mutant:", subsetData$Mutant[i])))
                            ),
                            "Insectary" = fluidRow(
                              column(6, p(paste("Species:", subsetData$Species[i]))),
                              column(6, p(paste("Subspecies/Form:", subsetData$Subspecies_Form[i]))),
                              column(6, p(paste("Sex:", subsetData$Sex[i]))),
                              column(6, p(paste("Insectary ID:", subsetData$Insectary_ID[i])))
                            ),
                            fluidRow()
        )
        
        tagList(
          h3(style = "font-weight: bold; font-size: larger;", paste("CAM ID:", subsetData$CAM_ID[i])),
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
      
      extra_ui <- list(tags$script(HTML(js_code)))
      
      # Append a "Load More" button if there are still rows left
      if (end_row < nrow(filteredData)) {
        extra_ui <- c(extra_ui, list(
          div(style = "text-align:center; margin-top:10px;",
              actionButton(paste0(displayId, "_load_more"), "Load More"))
        ))
      }
      
      do.call(tagList, c(list(count_message), img_tags, extra_ui))
    })
    ## ------------------------------------------------------------------------- ##
    
    ## register (only once) the observer that shows the next 200 rows
    if (is.null(observer_created[[displayId]])) {
      observer_created[[displayId]] <<- TRUE
      observeEvent(input[[paste0(displayId, "_load_more")]], {
        renderThumbnails(displayId,
                         data_cache[[displayId]],
                         data_source,
                         side_sel_cache[[displayId]],
                         reset = FALSE)          # just extend, don't reset counter
      }, ignoreNULL = TRUE, ignoreInit = TRUE)
    }
  }
  
  # Small, explicit helper for selectize inputs
  set_selectize <- function(inputId, choices, selected = "All", add_all = TRUE, server = FALSE) {
    ch <- sort(unique(na.omit(choices)))
    if (add_all) ch <- c("All" = "All", ch)
    updateSelectizeInput(session, inputId, choices = ch, selected = selected, server = server)
  }
  
  # Centralized sorting function
  apply_sort <- function(df, sort_by, sort_order, date_col_map = NULL) {
    if (identical(sort_by, "Row Number")) return(df)
    col <- rlang::sym(if (!is.null(date_col_map) && sort_by %in% names(date_col_map)) date_col_map[[sort_by]] else sort_by)
    if (identical(sort_order, "asc")) arrange(df, !!col, CAM_ID) else arrange(df, desc(!!col), desc(CAM_ID))
  }
  
  # Reactive expressions for taxa selection
  observe({
    set_selectize("taxa_family_selection", data$Collection_data$Family)
    set_selectize("taxa_id_status_selection", data$Collection_data$ID_status)
  })
  
  observeEvent(input$taxa_family_selection, {
    filteredData <- data$Collection_data %>%
      filter(Family == input$taxa_family_selection | input$taxa_family_selection == "All")
    set_selectize("taxa_subfamily_selection", filteredData$Subfamily)
  })
  
  observeEvent(input$taxa_subfamily_selection, {
    filteredData <- data$Collection_data %>%
      filter(Subfamily == input$taxa_subfamily_selection | input$taxa_subfamily_selection == "All")
    set_selectize("taxa_tribe_selection", filteredData$Tribe)
  })
  
  observeEvent(input$taxa_tribe_selection, {
    filteredData <- data$Collection_data %>%
      filter(Tribe == input$taxa_tribe_selection | input$taxa_tribe_selection == "All")
    set_selectize("taxa_species_selection", filteredData$Species, selected = NULL)
  })
  
  observeEvent(input$taxa_species_selection, {
    filteredData <- data$Collection_data %>%
      filter(Species %in% input$taxa_species_selection | "All" %in% input$taxa_species_selection)
    set_selectize("taxa_subspecies_selection", filteredData$Subspecies_Form)
  })
  
  # Helper for filtering
  `%in_all%` <- function(taxa, select) { ("All" %in% select) | (taxa %in% select) }
  # Observe event for "Search by Taxa"
  observeEvent(input$taxa_show_photos, {
    filteredData <- data$Collection_data %>%
      filter(
        Family          %in_all% input$taxa_family_selection,
        Subfamily       %in_all% input$taxa_subfamily_selection,
        Tribe           %in_all% input$taxa_tribe_selection,
        Species         %in_all% input$taxa_species_selection,
        Subspecies_Form %in_all% input$taxa_subspecies_selection,
        if (identical(input$taxa_sex_selection, "male and female")) TRUE else Sex %in_all% input$taxa_sex_selection,
        ID_status       %in_all% input$taxa_id_status_selection
      )
    
    if (input$exclude_without_photos) {
      filteredData <- filteredData %>% filter(!is.na(URLd) | !is.na(URLv))
    }
    
    if (input$one_per_subspecies_sex) {
      filteredData <- filteredData %>% group_by(Subspecies_Form, Sex) %>% slice(1) %>% ungroup()
    }
    
    # Apply sorting
    filteredData <- apply_sort(filteredData, input$sort_by, input$sort_order,
                               date_col_map = c(Preservation_date = "Preservation_date"))
    
    renderThumbnails("taxa_photos_display", filteredData, data_source = "Collection", side_selection = input$side_selection)
  })
  
  # Observe event for "CRISPR" tab
  observe({
    set_selectize("crispr_species_selection", data$CRISPR$Species)
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
    filteredCRISPR <- apply_sort(filteredCRISPR, input$sort_by, input$sort_order,
                                 date_col_map = c(Preservation_date = "Emerge_date"))
    
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
    set_selectize("insectary_species_selection", data$Insectary_data$Species)
  })
  
  observeEvent(input$insectary_species_selection, {
    filteredData <- data$Insectary_data %>%
      filter(Species == input$insectary_species_selection | input$insectary_species_selection == "All")
    set_selectize("insectary_subspecies_selection", filteredData$Subspecies_Form)
    set_selectize("insectary_id_selection", filteredData$Insectary_ID, server = TRUE)
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
    filteredData <- apply_sort(filteredData, input$sort_by, input$sort_order,
                               date_col_map = c(Preservation_date = "Preservation_date"))
    
    renderThumbnails("insectary_photos_display", filteredData, data_source = "Insectary", side_selection = input$side_selection)
  })
}

# Run the application
shinyApp(ui = ui, server = server)