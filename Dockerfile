FROM oven/bun:latest AS builder

RUN apt-get update && apt-get install -y unzip git

WORKDIR /app

RUN git clone https://github.com/oven-sh/bun.git

WORKDIR /app/bun/packages/bun-lambda

RUN bun install

RUN bun run build-layer

RUN unzip bun-lambda-layer.zip -d /tmp

WORKDIR /tmp

COPY ./src/Tach.ts .

COPY ./node_modules ./node_modules

RUN bun build --target=bun Tach.ts --outfile lambda

FROM public.ecr.aws/lambda/provided:al2

COPY --from=builder /tmp/lambda ${LAMBDA_TASK_ROOT}

COPY --from=builder /tmp/bootstrap ${LAMBDA_RUNTIME_DIR}

COPY --from=builder /tmp/bun /opt

COPY --from=builder /tmp/runtime.ts /opt

# CMD ["lambda.fetch"]