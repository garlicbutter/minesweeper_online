FROM rust:1.90-bookworm AS builder
WORKDIR /build
RUN rustup target add wasm32-unknown-unknown
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY tests ./tests
RUN ./scripts/build.sh && cargo test --locked

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /build/target/release/minefield /usr/local/bin/minefield
COPY --from=builder /build/public/minefield.wasm ./public/minefield.wasm
RUN mkdir .data && chown -R 1000:1000 /app
USER 1000:1000
ENV PORT=3000
EXPOSE 3000
CMD ["minefield"]
