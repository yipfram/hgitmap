FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/target/release/backend /app/backend
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["/app/backend"]
