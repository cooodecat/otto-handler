exports.handler = async (event) => {
    console.log('Lambda function started');
    console.log('Received EventBridge event:', JSON.stringify(event, null, 2));
    
    const BACKEND_URL = process.env.BACKEND_URL || 'https://api.codecat-otto.shop';
    const API_KEY = process.env.API_KEY || 'prod-eventbridge-key-secure-2025';
    
    console.log('Environment variables:');
    console.log('BACKEND_URL:', BACKEND_URL);
    console.log('API_KEY:', API_KEY ? 'Set (hidden)' : 'Not set');
    
    const url = `${BACKEND_URL}/api/v1/events/process`;
    console.log('Target URL:', url);
    
    const postData = JSON.stringify(event);
    console.log('Request body size:', postData.length, 'bytes');
    
    const startTime = Date.now();
    console.log('Starting fetch request...');
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds timeout
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            },
            body: postData,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const responseTime = Date.now() - startTime;
        console.log('Response received in', responseTime, 'ms');
        console.log('Response status code:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
        
        const responseText = await response.text();
        console.log('Response body:', responseText);
        
        let parsedData;
        try {
            parsedData = JSON.parse(responseText);
            console.log('Backend response:', parsedData);
        } catch (parseError) {
            console.error('Failed to parse response as JSON:', parseError);
            parsedData = responseText;
        }
        
        if (response.ok) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'Event processed successfully',
                    backendResponse: parsedData
                })
            };
        } else {
            console.error('Backend returned error status:', response.status);
            return {
                statusCode: response.status,
                body: JSON.stringify({
                    success: false,
                    message: `Backend returned status ${response.status}`,
                    backendResponse: parsedData
                })
            };
        }
    } catch (error) {
        const errorTime = Date.now() - startTime;
        console.error('Request failed after', errorTime, 'ms');
        console.error('Request error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        
        // Handle specific error types
        if (error.name === 'AbortError') {
            console.error('Request timeout after 20 seconds');
            return {
                statusCode: 504,
                body: JSON.stringify({
                    success: false,
                    message: 'Request timeout'
                })
            };
        } else if (error.cause?.code === 'ECONNREFUSED') {
            console.error('Connection refused - backend might be down');
            return {
                statusCode: 502,
                body: JSON.stringify({
                    success: false,
                    message: 'Failed to connect to backend - connection refused',
                    error: {
                        code: 'ECONNREFUSED',
                        message: error.message
                    }
                })
            };
        } else if (error.cause?.code === 'CERT_HAS_EXPIRED' || error.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            console.error('SSL certificate issue');
            return {
                statusCode: 502,
                body: JSON.stringify({
                    success: false,
                    message: 'SSL certificate verification failed',
                    error: {
                        code: error.cause?.code,
                        message: error.message
                    }
                })
            };
        } else {
            // Generic error handling
            return {
                statusCode: 502,
                body: JSON.stringify({
                    success: false,
                    message: 'Failed to connect to backend',
                    error: {
                        name: error.name,
                        message: error.message,
                        code: error.cause?.code
                    }
                })
            };
        }
    }
};