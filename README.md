# Docker SaaS Platform

A multi-service SaaS starter built with Node.js, Express, Prisma, PostgreSQL, Redis, and Docker.

This repository now implements a real backend foundation rather than a toy demo:

- API gateway with route protection, request validation, request logging, and Redis-backed rate limiting
- Auth service with bcrypt password hashing and JWT access/refresh tokens
- User service with Prisma models, CRUD endpoints, soft deletes, audit logs, and product persistence
- Product service as a thin facade over the database-backed product endpoints
- Notification service with a background queue-style worker
- Docker Compose setup with Postgres, Redis, health checks, restart policies, and volumes

## What We Implemented

### 1. API Gateway

The gateway is the single entry point for the platform.

Implemented behavior:

- Routes `/api/auth` to the auth service
- Routes `/api/users` to the user service
- Routes `/api/products` to the product service
- Verifies JWT access tokens for protected routes
- Adds `x-user-id`, `x-user-email`, and `x-user-role` headers for downstream services
- Applies Redis-backed rate limiting, with an in-memory fallback if Redis is unavailable
- Logs every request with method, path, status, duration, and user info
- Validates basic request bodies for auth and product endpoints

Important note:

- The gateway verifies JWTs locally using the shared secret.
- Rate limiting uses Redis when possible, which is the correct production direction for a shared counter.

### 2. Auth Service

The auth service now handles real authentication flows instead of demo token generation.

Implemented behavior:

- `POST /register`
  - Validates name, email, and password
  - Hashes passwords with `bcrypt`
  - Creates a user profile in the user service
  - Issues access and refresh tokens
  - Queues a welcome notification
- `POST /login`
  - Verifies the password hash
  - Issues new access and refresh tokens
- `POST /refresh`
  - Verifies the refresh token
  - Rotates the refresh token
- `POST /logout`
  - Invalidates the stored refresh token for that user
- `GET /health`
  - Returns service status

Important note:

- Auth sessions are stored in Redis when available, with in-memory fallback if Redis is not reachable.
- That gives the auth service durable refresh-token storage in the normal Docker setup.

### 3. User Service

The user service is backed by Prisma and PostgreSQL.

Implemented behavior:

- `POST /users`
  - Creates a user profile
- `GET /users`
  - Returns all active users
  - Supports `includeDeleted=true`
- `GET /users/:id`
  - Returns one user profile
- `PATCH /users/:id`
  - Updates name, email, and role
- `DELETE /users/:id`
  - Soft deletes the user instead of removing the row
- `GET /products`
  - Returns all active products
- `GET /products/:id`
  - Returns one product
- `POST /products`
  - Creates a product in PostgreSQL
- `PATCH /products/:id`
  - Updates a product
- `DELETE /products/:id`
  - Soft deletes a product
- `GET /health`
  - Returns service status

Database changes:

- `User` model includes:
  - `id`
  - `name`
  - `email`
  - `role`
  - `createdAt`
  - `updatedAt`
  - `deletedAt`
- `AuditLog` model stores create/update/delete events
- `Product` model now stores product records in PostgreSQL
- `UserRole` enum supports `ADMIN`, `MANAGER`, and `USER`

### 4. Product Service

The product service is now a dedicated microservice that forwards requests to the database-backed product endpoints.

Implemented behavior:

- `GET /products`
- `GET /products/:id`
- `POST /products`
- `PATCH /products/:id`
- `DELETE /products/:id`
- `GET /health`
- Soft deletes for products
- Role-based write protection for `admin` and `manager`

Important note:

- Product data is stored in PostgreSQL through the user service's Prisma client.
- The product service stays as a separate service boundary, which is useful for future extraction.

### 5. Notification Service

The notification service is a lightweight background worker.

Implemented behavior:

- `POST /internal/notifications`
  - Accepts queued notification jobs
  - Simulates background processing
- `GET /health`
- Logs queued jobs to the console

Current integration:

- The auth service sends a welcome notification after successful registration.

Important note:

- This is a simple queue simulation, not RabbitMQ or Kafka yet.

### 6. Docker and Infrastructure

The Compose file now includes:

- `gateway`
- `auth-service`
- `user-service`
- `product-service`
- `notification-service`
- `postgres`
- `redis`

Infrastructure features:

- Restart policies set to `always`
- Health checks for every service
- Persistent Docker volumes for:
  - PostgreSQL data
  - Redis data
- Environment-driven service URLs

## Current Service Flow

Typical request flow:

1. Client calls the gateway.
2. Gateway validates the request and checks the JWT when needed.
3. Gateway proxies the request to the correct service.
4. The target service performs the business logic.
5. Some actions emit internal follow-up work, such as notification jobs.

Example flows:

- `POST /api/auth/register`
  - Gateway validates body
  - Auth service hashes the password
  - Auth service creates a user profile through the user service
  - Auth service issues tokens
  - Auth service queues a welcome notification

- `GET /api/users`
  - Gateway verifies the access token
  - User service reads data from PostgreSQL
  - Gateway passes request metadata through headers

- `POST /api/products`
  - Gateway verifies the access token
  - Gateway checks the user role
  - Product service forwards the request to the user service
  - User service persists the product in PostgreSQL

## Project Structure

- `gateway/` - API entry point and request proxy
- `auth-service/` - registration, login, token flows
- `user-service/` - Prisma-backed user and product management
- `product-service/` - product API façade
- `notification-service/` - async-style job consumer
- `docker-compose.yml` - full local stack
- `IMPLEMENTATION_PLAN.md` - phased roadmap

## Environment Variables

### Gateway

- `PORT`
- `AUTH_SERVICE_URL`
- `USER_SERVICE_URL`
- `PRODUCT_SERVICE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`

### Auth Service

- `PORT`
- `USER_SERVICE_URL`
- `NOTIFICATION_SERVICE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ACCESS_TOKEN_EXPIRES_IN`
- `REFRESH_TOKEN_EXPIRES_IN`
- `BCRYPT_ROUNDS`

### User Service

- `PORT`
- `DATABASE_URL`

### Product Service

- `PORT`
- `USER_SERVICE_URL`

### Docker Compose Defaults

- PostgreSQL user: `admin`
- PostgreSQL password: `admin`
- PostgreSQL database: `saasdb`

## Running Locally

### With Docker

```bash
docker compose up --build
```

Service ports:

- Gateway: `http://localhost:4000`
- Auth service: `http://localhost:4001`
- User service: `http://localhost:4002`
- Product service: `http://localhost:4003`
- Notification service: `http://localhost:4004`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

### Prisma

The user service schema and migration history are checked in. If you change the schema again, regenerate the client with:

```bash
cd user-service
npx prisma generate
```

## API Examples

### Register

```bash
POST /api/auth/register
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "secret123",
  "role": "user"
}
```

### Login

```bash
POST /api/auth/login
{
  "email": "alice@example.com",
  "password": "secret123"
}
```

### Users

```bash
GET /api/users
Authorization: Bearer <access-token>
```

### Products

```bash
POST /api/products
Authorization: Bearer <access-token>
{
  "name": "Starter Plan",
  "price": 29,
  "stock": 10,
  "description": "Monthly SaaS plan"
}
```

## What Is Still Pending

The current implementation is a strong foundation, but some enterprise features are still future work:

- Real message broker support like RabbitMQ or Kafka
- Centralized structured logging with Winston or Pino
- Error tracking with Sentry
- Full request schema validation with a library like Zod or Joi
- Automated tests

## Summary

This repo now behaves like a real SaaS backend starter instead of a demo:

- Authentication is secured and refresh sessions are Redis-backed
- Users and products are stored in PostgreSQL
- The gateway protects private APIs and uses Redis for rate limiting
- Notifications are handled through a dedicated worker service
- Docker Compose provisions the complete local environment

The next best step is to add automated tests, structured logging, and a real broker for notifications.
