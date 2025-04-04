FROM rocker/shiny-verse:latest

# Install only essential system dependencies for the required R packages
# Many packages are already included in shiny-verse
RUN apt-get update && apt-get install -y \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

# Create a directory for the app
RUN mkdir -p /srv/shiny-server/

# Copy only the R script first to leverage Docker cache
# Make sure the filename matches your actual script!
COPY Ikiam_Wings_Gallery_app.R /srv/shiny-server/

# Install all required R packages to be safe
# Some may already be in shiny-verse but installing again won't hurt
RUN R -e "install.packages(c('shiny', 'dplyr', 'readr', 'stringr', 'shinyWidgets', 'tidyr'))"

# Download and save the database files during build
RUN R -e 'app_content <- readLines("/srv/shiny-server/Ikiam_Wings_Gallery_app.R"); \
    app_content <- app_content[1:(length(app_content)-1)]; \
    writeLines(app_content, "/srv/shiny-server/temp_app.R"); \
    source("/srv/shiny-server/temp_app.R"); \
    Download_and_save_raw_data(); \
    print("Data downloaded and saved during build phase.")'

# Make the app directory writable by the shiny user
RUN chown -R shiny:shiny /srv/shiny-server

# Expose the port the app runs on
EXPOSE 8080

# Run the app using the correct script name
CMD ["R", "-e", "shiny::runApp('/srv/shiny-server/Ikiam_Wings_Gallery_app.R', host = '0.0.0.0', port = as.numeric(Sys.getenv('PORT', 8080)))"]