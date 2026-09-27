#!/usr/bin/env bash
# 코인원 1분봉 + 예측을 계산해서 data 브랜치에 올림 (한 번 실행)
set -e
cd "$GITHUB_WORKSPACE"
git fetch -q origin +refs/heads/data:refs/remotes/origin/data || true
node collect.mjs /tmp/history.json
node forecast.mjs /tmp/forecast.json || true
rm -rf /tmp/pub && mkdir -p /tmp/pub && cd /tmp/pub
git init -q
cp /tmp/history.json .
if [ -f /tmp/forecast.json ]; then cp /tmp/forecast.json .; fi
git add .
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "data update"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:data
