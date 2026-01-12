# Changelog

## 0.2.0 (2025-01-11)

This release is a significant architecture overhaul focused on performance, real-time capabilities, and agent interoperability.

### Breaking Changes

- **D1 replaced with Durable Objects**: The database layer now uses Cloudflare Durable Objects with embedded SQLite instead of D1. This provides single-digit millisecond latency and native WebSocket support. Existing D1 users should run the migration script before upgrading (see README).

### New Features

- **Real-time updates via WebSocket**: Connect to `/ws` for live events (cart updates, order status, inventory changes). Subscribe to specific topics or get everything.

- **OAuth 2.0 / UCP support**: Full OAuth 2.0 implementation with PKCE for platforms and AI agents to act on behalf of customers. Implements the Universal Commerce Protocol for agent-to-commerce interoperability. Discovery at `/.well-known/oauth-authorization-server`.

- **D1 migration script**: `scripts/migrate-d1-to-do.ts` exports data from D1 and imports into the new Durable Object storage.

### Improvements

- Database queries now use RPC calls to a single Durable Object, eliminating cold start variability
- WebSocket connections are handled natively by the DO, no external pubsub needed
- Simplified wrangler config with auto-provisioning

### Documentation

- Updated all documentation (README, llms.txt, llms-full.txt, api.md, index.html) to reflect the new architecture
- Added OAuth/UCP documentation across all doc files
- Added WebSocket real-time documentation
