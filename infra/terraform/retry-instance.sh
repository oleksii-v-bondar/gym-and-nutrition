#!/bin/bash
# Retry `terraform apply` cycling through availability domains until an ARM
# (A1.Flex) instance is successfully created. OCI Always Free ARM capacity is
# often exhausted, so this keeps trying. Optional Telegram notifications.
#
# Setup (optional notifications):
# 1. Message @BotFather on Telegram → /newbot → get the token
# 2. Message your bot, then visit:
#    https://api.telegram.org/bot<TOKEN>/getUpdates  to find your chat_id
# 3. Fill in the two variables below (leave blank to disable notifications)

TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""

INTERVAL=120          # seconds between full retry rounds
AD_COUNT=3            # ADs to cycle through (0..AD_COUNT-1); use 1 for single-AD regions
STATUS_INTERVAL=3600  # send a status update every hour while still retrying
LOG="/tmp/tf-retry.log"

notify() {
  local msg="$1"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="$TELEGRAM_CHAT_ID" \
      -d text="$msg" > /dev/null 2>&1
  fi
  echo "$msg" | tee -a "$LOG"
}

cd "$(dirname "$0")" || exit 1

echo "Starting retry loop at $(date)" | tee "$LOG"
notify "gym-tracker: retry script started."

attempt=0
last_status=$(date +%s)

while true; do
  for ad in $(seq 0 $((AD_COUNT - 1))); do
    attempt=$((attempt + 1))
    echo "[$(date)] Attempt #$attempt (AD index: $ad)" | tee -a "$LOG"

    output=$(terraform apply -auto-approve -var="ad_index=$ad" 2>&1)
    echo "$output" >> "$LOG"

    if echo "$output" | grep -q "Out of host capacity"; then
      echo "[$(date)] No capacity in AD $ad." | tee -a "$LOG"
    elif echo "$output" | grep -q "Apply complete"; then
      notify "gym-tracker: ARM instance created in AD $ad! Attempt #$attempt"
      exit 0
    else
      notify "gym-tracker: terraform failed with an unexpected error on attempt #$attempt (AD $ad). Check $LOG."
      exit 1
    fi
  done

  now=$(date +%s)
  if [ "$((now - last_status))" -ge "$STATUS_INTERVAL" ]; then
    notify "gym-tracker: still retrying... $attempt attempts so far."
    last_status=$now
  fi

  echo "[$(date)] All ADs exhausted. Waiting ${INTERVAL}s..." | tee -a "$LOG"
  sleep "$INTERVAL"
done
