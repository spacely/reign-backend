# Reign Backend

A Node.js backend web server built with Express.js.

## Features

- Express.js web server
- CORS enabled
- Security headers with Helmet
- Environment variables support
- Error handling middleware
- Health check endpoint
- JSON body parsing

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd reign-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` with your configuration.

## Development

To start the development server with hot reload:

```bash
npm run dev
# or
yarn dev
```

## Production

To start the production server:

```bash
npm start
# or
yarn start
```

## Testing

To run tests:

```bash
npm test
# or
yarn test
```

## API Endpoints

- `GET /`: Welcome message
- `GET /health`: Health check endpoint

## License

ISC 