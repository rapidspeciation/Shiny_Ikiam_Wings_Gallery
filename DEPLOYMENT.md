# Deploying a Shiny App on Amazon EC2 with a Custom Domain

This guide provides step-by-step instructions for deploying the Shiny Ikiam Wings Gallery application on Amazon EC2 with a custom domain using FreeDNS.

## Step 1: Launch an EC2 Instance

1. Navigate to the EC2 Console: Go to the AWS Management Console and select EC2.
2. Launch Instance: Click "Launch Instance."
3. Choose an AMI: Select "Amazon Linux 2023 AMI (HVM)," making sure it's the t2.micro instance type (free tier eligible).
4. Configure Instance Details: Accept the defaults.
5. Add Storage: Accept the default storage.
6. Configure Security Group:
   - Add a rule to allow HTTP traffic on port 80 from all IPv4 addresses (0.0.0.0/0).
7. Review and Launch: Review your settings and launch the instance. Create a new key pair or use an existing one, and download the key file. You can also connect to your instance from the website (no need to ssh)

## Step 2: Connect and Configure the Instance

Connect to your instance and execute these commands:

```bash
# 1. Update system and install Docker
sudo dnf update -y
sudo dnf install docker -y
sudo systemctl start docker
sudo systemctl enable docker

# 2. (Optional) Add user to Docker group for non-sudo Docker commands else use sudo before docker commands
sudo usermod -aG docker $USER
newgrp docker
# you might need to reboot the instance for changes to take effect

# 3. Verify Docker installation
docker --version
sudo systemctl status docker

# 4. Install git and clone the app repository
sudo dnf install git -y
git clone https://github.com/rapidspecretion/Shiny_Ikiam_Wings_Gallery
cd Shiny_Ikiam_Wings_Gallery

# 5. Build and run the Docker container for the Shiny app
docker build -t shiny_ikiam_wings .
docker run -d -p 8080:8080 shiny_ikiam_wings

# 6. Install Nginx and disable Apache (if present)
sudo dnf install nginx -y
sudo systemctl stop httpd
sudo systemctl disable httpd

# 7. Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 8. Create Nginx reverse proxy configuration
sudo tee /etc/nginx/conf.d/shiny.conf > /dev/null <<EOF
# Nginx reverse proxy configuration for Shiny Ikiam Wings Gallery
# Routes HTTP traffic from port 80 to Shiny app on port 8080
server {
    listen 80;
    server_name wings.gallery.info.gf;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# 9. Test and reload Nginx configuration
sudo nginx -t && sudo systemctl reload nginx
```

aws links to the public ip addres with https but you change to http to load the app from port 80. E.g. [http://3.135.192.150](http://3.135.192.150) instead of [https://3.135.192.150](http://3.135.192.150)

## Step 3: Configure Custom Domain with FreeDNS

1. Go to [https://freedns.afraid.org/](https://freedns.afraid.org/).
2. Create an account or log in.
3. Add a new subdomain:
   - Set the "Type" to A
   - Enter your desired subdomain (e.g., wings.gallery.info)
   - Enter your EC2 instance's public IPv4 address as the "Destination" (e.g. 3.135.192.150)
   - Save the configuration

## Step 4: Access Your Shiny App

Open your web browser and navigate to your custom domain (e.g., http://wings.gallery.info.gf). You should see your Shiny app running. If website is not loading, wait for a few minutes until DNS changes take effect.