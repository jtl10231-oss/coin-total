#!/usr/bin/env bash
# 코인원 1분봉 + 예측을 계산해서 data 브랜치에 올림 (한 번 실행)
set -e
cd "$GITHUB_WORKSPACE"
git fetch -q origin +refs/heads/data:refs/remotes/origin/data || true
node collect.mjs /tmp/history.json
node forecast.mjs /tmp/forecast.json || true
# 뉴스는 4분 넘게 지났을 때만 다시 받음 (약 5분 간격)
if [ ! -f /tmp/news.json ] || [ $(( $(date +%s) - $(stat -c %Y /tmp/news.json) )) -gt 240 ]; then node news.mjs /tmp/news.json.new && mv /tmp/news.json.new /tmp/news.json || true; fi
if [ ! -f /tmp/news.json ]; then git show origin/data:news.json > /tmp/news.json 2>/dev/null || rm -f /tmp/news.json; fi
# 코인 급변 텔레그램 알림 (1분 수집 실행에서만). 상태 파일은 항상 이어서 보관
if [ ! -f /tmp/alert_state.json ]; then git show origin/data:alert_state.json > /tmp/alert_state.json 2>/dev/null || rm -f /tmp/alert_state.json; fi
if [ "$PRICE_ALERT" = "1" ]; then node price_alert.mjs /tmp/history.json /tmp/alert_state.json || true; fi
rm -rf /tmp/pub && mkdir -p /tmp/pub && cd /tmp/pub
git init -q
cp /tmp/history.json .
if [ -f /tmp/forecast.json ]; then cp /tmp/forecast.json .; fi
if [ -f /tmp/news.json ]; then cp /tmp/news.json .; fi
if [ -f /tmp/alert_state.json ]; then cp /tmp/alert_state.json .; fi
git add .
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "data update"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:data
