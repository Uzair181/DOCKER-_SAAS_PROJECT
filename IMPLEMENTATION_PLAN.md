# SaaS Docker Platform Implementation Plan

## Phase 1: Core SaaS Foundation

Goal: turn the existing prototype into a secure, runnable multi-service baseline.

- Auth service
  - Hash passwords with `bcrypt`
  - Issue access and refresh tokens
  - Support login, register, refresh, logout, and health checks
  - Create user profiles through the user service instead of keeping auth data only in memory
- User service
  - Expand Prisma schema with roles, timestamps, soft deletes, and audit logs
  - Add CRUD endpoints for profile management
  - Record audit log entries for create, update, and delete operations
- Gateway
  - Add JWT verification before protected routes
  - Add basic rate limiting
  - Add request logging
  - Add request validation for auth and product APIs
  - Route `/api/products` to the product service
- Compose
  - Add persistent Postgres and Redis volumes
  - Add health checks and restart policies
  - Add environment-driven service URLs

## Phase 2: Product and Notification Services

Goal: finish the service layout that companies expect in a SaaS starter.

- Product service
  - Add CRUD endpoints for products
  - Support soft deletes
  - Enforce role-based write access
- Notification service
  - Add a lightweight worker loop for queued notifications
  - Accept internal notification jobs from other services
  - Prepare the service for later RabbitMQ/Kafka replacement

## Phase 3: Performance and Eventing

Goal: make the platform behave more like a production SaaS system.

- Redis-backed caching
  - Cache sessions
  - Cache read-heavy API responses
  - Store rate-limit counters
- Internal service events
  - Emit user-created and product-updated events
  - Consume events in the notification service

## Phase 4: Observability and Hardening

Goal: make the platform maintainable in production.

- Structured logging
- Error tracking
- Container log aggregation
- Stronger validation and test coverage

