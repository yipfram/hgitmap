#!/bin/sh
# Inject the API URL at runtime into the prebuilt bundle.
set -e
: "${VITE_API_URL:?VITE_API_URL must be set (public URL of the backend)}"
find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.html' \) \
  -exec sed -i "s|__VITE_API_URL__|${VITE_API_URL}|g" {} +
