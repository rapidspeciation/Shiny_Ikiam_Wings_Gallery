FROM rocker/shiny-verse:latest

# Create a directory for the app
RUN mkdir -p /srv/shiny-server/

# Copy the R scripts
COPY Ikiam_Wings_Gallery_app.R /srv/shiny-server/
COPY download_data.R /srv/shiny-server/

# Install shinyWidgets which is not included in shiny-verse
RUN R -e "install.packages('shinyWidgets')"

# Download data during build
RUN R -e "source('/srv/shiny-server/download_data.R')"

# Make the app directory writable by the shiny user
RUN chown -R shiny:shiny /srv/shiny-server

# Expose the port the app runs on
EXPOSE 8080

# Run the app
CMD ["R", "-e", "shiny::runApp('/srv/shiny-server/Ikiam_Wings_Gallery_app.R', host = '0.0.0.0', port = as.numeric(Sys.getenv('PORT', 8080)))"]