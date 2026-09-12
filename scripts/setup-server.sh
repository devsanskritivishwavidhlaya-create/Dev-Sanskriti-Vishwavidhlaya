#!/bin/bash
# One-time server setup script for Oracle Cloud Ubuntu VM
# Run as root or with sudo

set -e

echo "=== Dev Sanskriti Vishwavidyalaya Server Setup ==="

# Update system
echo "[1/7] Updating system packages..."
apt update && apt upgrade -y

# Install Nginx
echo "[2/7] Installing Nginx..."
apt install -y nginx

# Install Git
echo "[3/7] Installing Git..."
apt install -y git

# Install Certbot for SSL
echo "[4/7] Installing Certbot..."
apt install -y certbot python3-certbot-nginx

# Create deploy user
echo "[5/7] Creating deploy user..."
if ! id "deploy" &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG sudo deploy
    echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/git, /usr/sbin/nginx, /bin/chown, /bin/chmod" > /etc/sudoers.d/deploy
    chmod 0440 /etc/sudoers.d/deploy
fi

# Setup deployment directory
echo "[6/7] Setting up deployment directory..."
mkdir -p /var/www/dsvv.ac.in
cd /var/www/dsvv.ac.in
git init
git remote add origin https://github.com/Absahgih2/Dev-Sanskriti-Vishwavidhlaya.git
git fetch origin main
git checkout -f origin/main
chown -R www-data:www-data /var/www/dsvv.ac.in

# Configure Nginx
echo "[7/7] Configuring Nginx..."
cp /var/www/dsvv.ac.in/nginx/dsvv.conf /etc/nginx/sites-available/dsvv.ac.in
ln -sf /etc/nginx/sites-available/dsvv.ac.in /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Add your SSH public key to /home/deploy/.ssh/authorized_keys"
echo "2. Point your domain DNS (dsvv.ac.in) to this server's public IP"
echo "3. Run: sudo certbot --nginx -d dsvv.ac.in -d www.dsvv.ac.in"
echo "4. Add GitHub secrets: VM_HOST, VM_USER, SSH_PRIVATE_KEY"
echo ""
echo "Server IP: $(curl -s ifconfig.me)"
