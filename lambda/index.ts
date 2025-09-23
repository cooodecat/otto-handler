import { EventBridgeEvent as AWSEventBridgeEvent } from 'aws-lambda';

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
  const url = `${BACKEND_URL}${path}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const responseBody = await response.text();
    
    if (!response.ok) {
      throw new Error(`Backend returned status ${response.status}: ${responseBody}`);
    }
    
    try {
      return JSON.parse(responseBody);
    } catch (error) {
      throw new Error(`Failed to parse backend response: ${responseBody}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after 30 seconds');
      }
      throw error;
    }
    throw new Error('Unknown error occurred');
  }
}