import { EventBridgeEvent as AWSEventBridgeEvent } from 'aws-lambda';
import * as https from 'https';
import * as http from 'http';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const API_KEY = process.env.API_KEY || 'local-dev-key';

interface CodeBuildEventDetail {
  'build-status': string;
  'build-id': string;
  'project-name': string;
  'current-phase'?: string;
  'current-phase-context'?: string;
  'additional-information'?: any;
}

export const handler = async (
  event: AWSEventBridgeEvent<'CodeBuild Build State Change', CodeBuildEventDetail>
): Promise<{ statusCode: number; body: string }> => {
  console.log('Received EventBridge event:', JSON.stringify(event, null, 2));

  try {
    const eventPayload = {
      id: event.id,
      version: event.version,
      account: event.account,
      time: event.time,
      region: event.region,
      source: event.source,
      resources: event.resources,
      'detail-type': event['detail-type'],
      detail: event.detail,
    };

    const result = await sendToBackend('/api/v1/events/process', eventPayload);

    console.log('Backend response:', result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Event processed successfully',
        eventId: event.id,
      }),
    };
  } catch (error) {
    console.error('Error processing event:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to process event',
        eventId: event.id,
      }),
    };
  }
};

async function sendToBackend(path: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(BACKEND_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
    };

    const req = client.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          const parsedResponse = JSON.parse(responseBody);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedResponse);
          } else {
            reject(new Error(`Backend returned status ${res.statusCode}: ${responseBody}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse backend response: ${responseBody}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout after 30 seconds'));
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}