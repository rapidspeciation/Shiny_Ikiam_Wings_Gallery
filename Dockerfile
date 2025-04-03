FROM rocker/shiny:4.3.2

# Install only essential system dependencies for the required R packages
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

# Install only the necessary R packages and their dependencies
RUN R -e "install.packages(c('shiny', 'dplyr', 'readr', 'stringr', 'shinyWidgets', 'tidyr'), repos='https://cloud.r-project.org/')"

# Note: The R script tries to save/load .rds files. 
# It will download and save them inside the container if they don't exist.
# No need to COPY .rds files during the build unless they *must* pre-exist.

# Make the app directory writable by the shiny user
RUN chown -R shiny:shiny /srv/shiny-server

# Expose the port the app runs on
EXPOSE 8080

# Run the app using the correct script name
CMD ["R", "-e", "shiny::runApp('/srv/shiny-server/Ikiam_Wings_Gallery_app.R', host = '0.0.0.0', port = as.numeric(Sys.getenv('PORT', 8080)))"]