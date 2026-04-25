FROM alpine:3.20

RUN apk add --no-cache tinyproxy \
 && mkdir -p /var/log/tinyproxy \
 && touch /var/log/tinyproxy/tinyproxy.log

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY filter /etc/tinyproxy/filter

EXPOSE 8888

# Run tinyproxy in foreground; tail -F the log file to stdout so
# connection events show up in `docker logs`. exec-replace tinyproxy as
# PID 1 so signals work correctly; tail runs as a background helper.
CMD ["sh", "-c", "tail -F /var/log/tinyproxy/tinyproxy.log & exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf"]
