FROM oven/bun:1-alpine

WORKDIR /app

# Install deps with the lockfile only — fails the build if it's out of sync.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Source + the agent.md boot contract.
COPY src ./src
COPY tsconfig.json ./
COPY agent.md ./

# Trace dir is a volume so traces survive container restarts.
RUN mkdir -p /app/traces
VOLUME ["/app/traces"]

# Default mode: read newline-delimited JSON Events from stdin.
# Override the CMD to dispatch a single event:
#   docker run --rm event-machine ping
ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["--stdin"]
