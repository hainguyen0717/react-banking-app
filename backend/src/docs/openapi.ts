export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Banking Authentication API',
    version: '1.0.0',
    description:
      'Simple authentication service that validates customer credentials and issues session tokens.'
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local development server'
    }
  ],
  paths: {
    '/api/login': {
      post: {
        summary: 'Validate customer credentials and issue a token',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/LoginRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Credentials validated successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginResponse'
                }
              }
            }
          },
          '400': {
            description: 'Invalid request payload',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            description: 'Invalid email or password',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'jane.doe@example.com'
          },
          password: {
            type: 'string',
            format: 'password',
            minLength: 8,
            example: 'Sup3rSecret!'
          }
        }
      },
      LoginResponse: {
        type: 'object',
        required: ['token', 'customerId', 'customerName'],
        properties: {
          token: {
            type: 'string',
            description: 'Opaque session token that represents the authenticated customer.'
          },
          customerId: {
            type: 'string',
            example: 'cust-1001'
          },
          customerName: {
            type: 'string',
            example: 'Jane Doe'
          }
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'string'
          },
          details: {
            type: 'object',
            additionalProperties: true
          }
        }
      }
    }
  }
} as const;
