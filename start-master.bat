@echo off
cd /d C:\master-web
start "" http://localhost:9090
npx --yes serve . -l 9090

