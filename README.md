# Tachyon

Tachyon is a simple to use API framework built with TypeScript (Bun), which was inspired by Fastly  and FastAPI (Python). Tachyon aim to provide a simple and intuitive API framework for building serverless applications and abstracts away the complexity of configuations, letting you focus on building your application.

## Features

- Has BYOS [(Bring Your Own Storage)](https://github.com/Chidelma/BYOS) integration
- Use of decorators for routes
- Customizable methods for routes
- AWS Lambda support (Docker)
- Use of file-system based routing
- Hot reloading of routes in development mode
- Supports dynamic routes
- Supports Async Iterators (Streaming)

## Installation

```bash
npm install @vyckr/tachyon
```

## Configuration

The .env file should be in the root directory of your project. The following environment variables:
```
# Tachyon environment variables
PORT=8000 (optional)
ALLOW_HEADERS=* (optional)
ALLOW_ORGINS=* (optional)
ALLOW_CREDENTIALS=true|false (optional)
ALLOW_EXPOSE_HEADERS=* (optional)
ALLOW_MAX_AGE=3600 (optional)
ALLOW_METHODS=GET,POST,PUT,DELETE,PATCH (optional)
PRODUCTION=true|false (optional)
SAVE_LOGS=true|false (optional)
SAVE_STATS=true|false (optional)
SAVE_REQUESTS=true|false (optional)
SAVE_ERRORS=true|false (optional)

# BYOS environment variables
DB_DIR=/path/to/disk/database (required)
SCHEMA=LOOSE|STRICT (optional)
LOGGING=true|false (optional)
SCHEMA_PATH=/path/to/schema/directory (required if SCHEMA is set to STRICT)
MEM_DR=/path/to/memory/database (optional)
S3_REGION=region (optional)
S3_INDEX_BUCKET=bucket (required)
S3_DATA_BUCKET=bucket (required)
S3_ENDPOINT=https//example.com (optional)
```

## Usage/Example

Make sure you have set the 'SCHEMA_PATH' if 'SCHEMA' is set to 'STRICT'. The schema path should be a directory containing the declaration files. for example:

```
/path/to/schema/directory
    /users.d.ts
```
### Requirements
- Make sure to have a 'routes' directory in the root of your project
- Dynamic routes should be enclosed in square brackets
- The first parameter should NOT be a dynamic route (e.g. /[version]/doc/index.ts)
- All dynamic routes should be within odd indexes (e.g. /v1/[path]/login/[id]/name/index.ts)
- The last parameter in the route should not be a dynamic route (e.g. /v1/[path]/login/[id]/name/index.ts)

```typescript
// routes/v1/[collection]/doc/index.ts
import Silo from "@vyckr/byos"
imoprt { VALIDATE } from "../utils/decorators"

export default class Users {

    static collection = "[collection]"

    @VALIDATE
    async GET({ slugs }) {
        return await Silo.findDocs(slugs.get(this.collection), { $limit: 10 })
    }

    @VALIDATE
    async POST(user: _user, { slugs }) {
        return await Silo.putData(slugs.get(this.collection), { name: user.name, age: user.age })
    }

    @VALIDATE
    async PATCH(user: _user, { slugs }) {
        return await Silo.patchDoc(slugs.get(this.collection), { $set: { name: user.name, age: user.age } })
    }

    @VALIDATE
    async DELETE(id: string, { slugs }) {
        await Silo.delDoc(slugs.get(this.collection), id)
    }   
}
```

To run the application, you can use the following command:

```bash 
bun tach
```

To invoke the API endpoints, you can use the following commands:

```bash
curl -X GET http://localhost:8000/v1/users/doc
```

```bash
curl -X POST http://localhost:8000/v1/users/doc -d '{"name": "John Doe", "age": 30}'
```

```bash
curl -X PATCH http://localhost:8000/v1/users/doc -d '{"name": "Jane Doe", "age": 31}'
```

```bash
curl -X DELETE http://localhost:8000/v1/users/doc/5e8b0a9c-c0d1-4d3b-a0b1-e2d8e0e9a1c0
```

# License

Tachyon is licensed under the MIT License.