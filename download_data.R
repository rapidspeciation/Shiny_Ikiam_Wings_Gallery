# Load required libraries
library(dplyr)
library(stringr)
library(readr)
library(tidyr)

# Set locale for date parsing
Sys.setlocale(locale = "en_US.UTF-8")

# Define constants
gsheet_id <- "1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4"
sheets <- c("Collection_data", "Photo_links", "CRISPR", "Insectary_data")
rds_paths <- setNames(paste0(sheets, ".rds"), sheets)

# Function to download and save data
download_and_save_data <- function(show_toasts = FALSE) {
  # Download data from Google Sheets
  data_list <- lapply(sheets, function(sheet_name) {
    if (show_toasts) {
      showNotification(paste("Downloading", sheet_name, "sheet..."), 
                      type = "message", 
                      duration = NULL,
                      id = "downloading")
    }
    
    url <- paste0("https://docs.google.com/spreadsheets/d/", gsheet_id, "/gviz/tq?tqx=out:csv&sheet=", URLencode(sheet_name))
    df <- read_csv(url, col_types = cols(.default = "c"))
    
    return(df)
  })
  
  # Name the data frames
  names(data_list) <- sheets
  
  # Save as RDS files
  mapply(saveRDS, data_list, rds_paths)
  
  if (show_toasts) {
    showNotification("All sheets downloaded and saved successfully!", 
                    type = "message", 
                    duration = 5,
                    id = "downloading")
  } else {
    print("Data downloaded and saved successfully!")
  }
  
  return(data_list)
}

# Execute the download only if run directly (not sourced)
if (!interactive()) {
  download_and_save_data(show_toasts = FALSE)
} 