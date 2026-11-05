#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 2 ]] || { echo 'Usage (root): bootstrap.sh ADMIN SSH_PUBLIC_KEY' >&2; exit 1; }
admin=$1
key=$2
[[ $admin =~ ^[a-z_][a-z0-9_-]*$ && $admin != root ]] || { echo 'Invalid admin name.' >&2; exit 1; }
[[ -f $key ]] || { echo 'Public key file missing.' >&2; exit 1; }
ssh-keygen -l -f "$key" >/dev/null
[[ $(wc -l < "$key") -le 1 ]] || { echo 'Supply one public key.' >&2; exit 1; }
grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+( .*)?$' "$key"
# shellcheck source=/dev/null
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || { echo 'Ubuntu 24.04 is required.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg python3 ufw fail2ban unattended-upgrades cron iproute2
install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.list
chmod 0644 /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
echo 'Installed Docker Engine and Compose from the official apt repository.'

if ! id "$admin" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$admin"
fi
admin_home=$(getent passwd "$admin" | cut -d: -f6)
[[ $admin_home != / && -d $admin_home ]]
usermod -aG docker "$admin"
[[ ! -L $admin_home/.ssh ]]
install -d -m 0700 -o "$admin" -g "$(id -gn "$admin")" "$admin_home/.ssh"
authorized="$admin_home/.ssh/authorized_keys"
[[ ! -L $authorized ]]
touch "$authorized"
if ! grep -qxF "$(cat "$key")" "$authorized"; then
    printf '\n%s\n' "$(cat "$key")" >> "$authorized"
fi
chown "$admin:$(id -gn "$admin")" "$authorized"
chmod 0600 "$authorized"
ssh-keygen -l -f "$authorized" >/dev/null
grep -qxF "$(cat "$key")" "$authorized"
install -d -m 0700 -o "$admin" -g "$(id -gn "$admin")" /srv/linkself-social /srv/linkself-social-private
echo 'Installed the admin key, Docker group membership, and private deployment directories.'

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
cat > /etc/fail2ban/jail.d/linkself.local <<'EOF'
[sshd]
enabled = true
backend = systemd
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
chmod 0644 /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now fail2ban unattended-upgrades docker cron
systemctl restart fail2ban
if [[ -z $(swapon --show --noheadings) ]]; then
    if [[ ! -e /swapfile ]]; then
        fallocate -l 2G /swapfile
        chmod 0600 /swapfile
        mkswap /swapfile >/dev/null
    fi
    [[ $(stat -c %s /swapfile) -eq 2147483648 ]]
    chmod 0600 /swapfile
    swapon /swapfile
    if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then
        printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
    fi
    echo 'Enabled 2 GB swap.'
else
    echo 'Existing swap retained.'
fi
install -d -m 0755 /etc/docker
python3 - <<'PY'
import json
from pathlib import Path
p = Path('/etc/docker/daemon.json')
data = json.loads(p.read_text()) if p.exists() else {}
data.update({'log-driver': 'json-file', 'log-opts': {'max-size': '10m', 'max-file': '3'}})
candidate = p.with_suffix('.candidate')
candidate.write_text(json.dumps(data, indent=2) + '\n')
PY
dockerd --validate --config-file=/etc/docker/daemon.candidate >/dev/null
if ! cmp -s /etc/docker/daemon.candidate /etc/docker/daemon.json; then
    mv /etc/docker/daemon.candidate /etc/docker/daemon.json
    systemctl restart docker
else
    rm /etc/docker/daemon.candidate
fi
# Elasticsearch needs this on the host, including after a reboot.
printf 'vm.max_map_count=262144\n' > /etc/sysctl.d/90-linkself.conf
chmod 0644 /etc/sysctl.d/90-linkself.conf
sysctl -p /etc/sysctl.d/90-linkself.conf >/dev/null
echo 'Configured firewall, intrusion protection, security updates, logs, and Elasticsearch kernel limit.'

# A low sort order takes precedence over the cloud image's usual SSH drop-in.
cat > /etc/ssh/sshd_config.d/00-linkself.conf <<'EOF'
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t
effective=$(sshd -T -C "user=$admin,host=localhost,addr=127.0.0.1")
for setting in 'pubkeyauthentication yes' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin no'; do
    grep -qxF "$setting" <<< "$effective" || { echo 'SSH policy conflict; SSH was not reloaded. Inspect the existing configuration.' >&2; exit 1; }
done
grep -Eq '^authorizedkeysfile .*\.ssh/authorized_keys( |$)' <<< "$effective"
systemctl reload ssh
echo 'SSH now requires keys and disallows root login. Keep this session open until a second admin SSH session succeeds.'
echo 'Bootstrap complete. Docker log defaults apply to newly created containers. Docker group access is root-equivalent.'
