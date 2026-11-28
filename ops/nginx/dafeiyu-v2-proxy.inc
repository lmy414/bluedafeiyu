include /etc/nginx/snippets/dafeiyu-v2-cloudflare.inc;
include /etc/nginx/snippets/dafeiyu-v2-security.inc;

client_max_body_size 100m;
proxy_http_version 1.1;
proxy_connect_timeout 5s;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header CF-Connecting-IP $remote_addr;
proxy_cache off;

# Hermes and the legacy CMS protocol use the host's loopback listener.
location = /api/v1/internal { return 404; }
location ^~ /api/v1/internal/ { return 404; }
location = /cms-api { return 404; }
location ^~ /cms-api/ { return 404; }

location ^~ /api/ {
    proxy_pass http://127.0.0.1:4331;
    proxy_hide_header Cache-Control;
    include /etc/nginx/snippets/dafeiyu-v2-security.inc;
    add_header Cache-Control "no-store" always;
}

location ^~ /open-api/ {
    proxy_pass http://127.0.0.1:4331;
    proxy_hide_header Cache-Control;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    include /etc/nginx/snippets/dafeiyu-v2-security.inc;
    add_header Cache-Control $dafeiyu_v2_open_api_cache always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "If-None-Match, If-Modified-Since" always;
    add_header Access-Control-Expose-Headers "ETag, Last-Modified" always;
    if ($request_method = OPTIONS) { return 204; }
}

location = /admin {
    include /etc/nginx/snippets/dafeiyu-v2-security.inc;
    add_header Cache-Control "no-store" always;
    add_header X-Robots-Tag "noindex, nofollow" always;
    return 308 /admin/$is_args$args;
}

location ^~ /admin/ {
    proxy_pass http://127.0.0.1:4331;
    proxy_hide_header Cache-Control;
    include /etc/nginx/snippets/dafeiyu-v2-security.inc;
    add_header Cache-Control "no-store" always;
    add_header X-Robots-Tag "noindex, nofollow" always;
}

location / {
    proxy_pass http://127.0.0.1:4330;
    proxy_hide_header Cache-Control;
    include /etc/nginx/snippets/dafeiyu-v2-security.inc;
    add_header Cache-Control $dafeiyu_v2_web_cache always;
}
