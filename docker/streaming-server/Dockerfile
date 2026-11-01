FROM nginx:alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf

RUN openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
    -keyout /etc/nginx/key.pem -out /etc/nginx/cert.pem \
    -subj /CN=streaming-server

CMD ["nginx", "-g", "daemon off;"]
