FROM oven/bun:latest AS build

RUN apt-get update && apt-get install -y unzip git

WORKDIR /app

RUN git clone https://github.com/oven-sh/bun.git

WORKDIR /app/bun/packages/bun-lambda

RUN bun install

RUN bun run build-layer

RUN unzip bun-lambda-layer.zip -d /tmp

WORKDIR /tmp

COPY package.json .

RUN bun install

FROM public.ecr.aws/lambda/provided:al2

COPY --from=build /tmp/node_modules ${LAMBDA_TASK_ROOT}/node_modules

COPY --from=build /tmp/package.json ${LAMBDA_TASK_ROOT}/package.json

COPY --from=build /tmp/bootstrap ${LAMBDA_RUNTIME_DIR}

COPY --from=build /tmp/bun /opt

COPY ./src/Tach.ts ${LAMBDA_TASK_ROOT}

COPY ./tsconfig.json ${LAMBDA_TASK_ROOT}

COPY ./src/runtime.ts /opt

RUN chmod 777 /opt/bun

RUN chmod 777 /opt/runtime.ts

RUN chmod 777 ${LAMBDA_TASK_ROOT}/Tach.ts

RUN chmod 777 ${LAMBDA_RUNTIME_DIR}/bootstrap

CMD ["Tach.fetch"]