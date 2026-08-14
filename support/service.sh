#!/bin/zsh
# Manages Sky Control as a per-user macOS LaunchAgent without touching system services.
set -euo pipefail

project_dir="${0:A:h:h}"
node_bin="${SKY_NODE:-$(command -v node || true)}"
if [[ -z "$node_bin" ]]; then
  echo "No node on PATH. Install Node.js, or set SKY_NODE to its absolute path." >&2
  exit 1
fi
node_bin="${node_bin:A}"

metadata() {
  "$node_bin" -e 'const p=require(process.argv[1]); process.stdout.write(String(p.skyControl[process.argv[2]]))' "$project_dir/package.json" "$1"
}

slug="${SKY_SLUG:-$(metadata serviceSlug)}"
app_name="${SKY_APP_NAME:-$(metadata displayName)}"
user_slug="$(id -un | tr '[:upper:]' '[:lower:]')"
label_template="$(metadata serviceId)"
default_label="${label_template/\{user\}/$user_slug}"
agent_label="${SKY_AGENT_LABEL:-$default_label}"

runtime_dir="$HOME/Library/Application Support/$app_name"
agents_dir="$HOME/Library/LaunchAgents"
log_dir="$HOME/Library/Logs"
agent_file="$agents_dir/$agent_label.plist"
agent_domain="gui/$(id -u)"

legacy_label="com.${user_slug}.sky-local"
legacy_runtime_dir="$HOME/Library/Application Support/Sky Local"
legacy_agent_file="$agents_dir/$legacy_label.plist"

action="${1:-status}"

case "$action" in
  install)
    required_major=22
    actual_major="$("$node_bin" -p 'process.versions.node.split(".")[0]')"
    if (( actual_major < required_major )); then
      echo "Node $("$node_bin" -v) is unsupported; Sky Control requires Node 22.13 or newer." >&2
      exit 1
    fi

    cd "$project_dir"
    npm run build

    launchctl bootout "$agent_domain/$legacy_label" 2>/dev/null || true
    launchctl bootout "$agent_domain/$agent_label" 2>/dev/null || true
    rm -f "$legacy_agent_file"

    mkdir -p "$runtime_dir/data" "$agents_dir" "$log_dir"
    ditto ".next/standalone" "$runtime_dir"
    ditto ".next/static" "$runtime_dir/.next/static"
    ditto "public" "$runtime_dir/public"
    install -m 644 "support/launcher.mjs" "$runtime_dir/launcher.mjs"
    [[ -f ".env.local" ]] && install -m 600 ".env.local" "$runtime_dir/.env.local"

    sed -e "s|__LABEL__|$agent_label|g" \
        -e "s|__NODE__|$node_bin|g" \
        -e "s|__RUNTIME_DIR__|$runtime_dir|g" \
        -e "s|__LOG_DIR__|$log_dir|g" \
        -e "s|__SLUG__|$slug|g" \
        "support/launchagent.plist.template" > "$agent_file"
    chmod 644 "$agent_file"
    plutil -lint "$agent_file" > /dev/null

    for state_file in aircos.json settings.json; do
      if [[ -f "$runtime_dir/data/$state_file" ]]; then
        continue
      elif [[ -f "$legacy_runtime_dir/data/$state_file" ]]; then
        install -m 600 "$legacy_runtime_dir/data/$state_file" "$runtime_dir/data/$state_file"
        echo "Carried over $state_file from the previous install."
      elif [[ -f "data/$state_file" ]]; then
        install -m 600 "data/$state_file" "$runtime_dir/data/$state_file"
      fi
    done

    launchctl bootstrap "$agent_domain" "$agent_file"
    echo "$app_name is installed and running at http://127.0.0.1:${SKY_CONTROL_PORT:-3000}"
    echo "Service: $agent_label"
    echo "Logs: $log_dir/$slug.log"
    ;;
  status)
    echo "Service: $agent_label"
    exec launchctl print "$agent_domain/$agent_label"
    ;;
  restart)
    launchctl kickstart -k "$agent_domain/$agent_label"
    echo "$app_name restarted."
    ;;
  uninstall)
    launchctl bootout "$agent_domain/$agent_label" 2>/dev/null || true
    rm -f "$agent_file"
    echo "$app_name LaunchAgent removed."
    echo "Configuration and runtime files were kept at: $runtime_dir"
    ;;
  *)
    echo "Usage: $0 {install|status|restart|uninstall}" >&2
    exit 2
    ;;
esac
