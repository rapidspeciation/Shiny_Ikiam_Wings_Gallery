FROM rocker/shiny:4.3.2

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libudunits2-dev \
    libgdal-dev \
    gdal-bin \
    libgeos-dev \
    libproj-dev \
    && rm -rf /var/lib/apt/lists/*

# Create a directory for the app
RUN mkdir -p /srv/shiny-server/

# Copy only the R files first to leverage Docker cache
COPY *.R /srv/shiny-server/

# Install R packages
RUN R -e "install.packages(c('shiny', 'dplyr', 'ggplot2', 'DT', 'shinythemes', 'shinyjs', 'shinyWidgets', 'plotly', 'leaflet', 'sf', 'rnaturalearth', 'rnaturalearthdata', 'viridis', 'RColorBrewer', 'scales', 'lubridate', 'stringr', 'tidyr', 'purrr', 'readr', 'tibble', 'forcats', 'magrittr', 'htmltools', 'htmlwidgets', 'jsonlite', 'yaml', 'markdown', 'rmarkdown', 'knitr', 'tinytex', 'xfun', 'pandoc', 'pandocfilters', 'pandoc-citeproc', 'pandoc-crossref', 'pandoc-include-code', 'pandoc-latex-environment', 'pandoc-latex-color', 'pandoc-latex-fontsize', 'pandoc-latex-margin', 'pandoc-latex-package', 'pandoc-latex-tabular', 'pandoc-latex-tabularx', 'pandoc-latex-tabularray', 'pandoc-latex-tcolorbox', 'pandoc-latex-tcolorboxx', 'pandoc-latex-tcolorboxy', 'pandoc-latex-tcolorboxz', 'pandoc-latex-tcolorboxa', 'pandoc-latex-tcolorboxb', 'pandoc-latex-tcolorboxc', 'pandoc-latex-tcolorboxd', 'pandoc-latex-tcolorboxe', 'pandoc-latex-tcolorboxf', 'pandoc-latex-tcolorboxg', 'pandoc-latex-tcolorboxh', 'pandoc-latex-tcolorboxi', 'pandoc-latex-tcolorboxj', 'pandoc-latex-tcolorboxk', 'pandoc-latex-tcolorboxl', 'pandoc-latex-tcolorboxm', 'pandoc-latex-tcolorboxn', 'pandoc-latex-tcolorboxo', 'pandoc-latex-tcolorboxp', 'pandoc-latex-tcolorboxq', 'pandoc-latex-tcolorboxr', 'pandoc-latex-tcolorboxs', 'pandoc-latex-tcolorboxt', 'pandoc-latex-tcolorboxu', 'pandoc-latex-tcolorboxv', 'pandoc-latex-tcolorboxw', 'pandoc-latex-tcolorboxx', 'pandoc-latex-tcolorboxy', 'pandoc-latex-tcolorboxz'), repos='https://cloud.r-project.org/')"

# Copy the data files
COPY *.rds /srv/shiny-server/

# Make the app directory writable
RUN chown -R shiny:shiny /srv/shiny-server

# Expose the port the app runs on
EXPOSE 8080

# Run the app
CMD ["R", "-e", "shiny::runApp('/srv/shiny-server/Ikiam_Wings_Gallery_app.R', host = '0.0.0.0', port = as.numeric(Sys.getenv('PORT', 8080)))"] 