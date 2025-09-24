const https = require('https');

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
    
    // Parse URL for https request
    const urlParts = new URL(url);
    
    const postData = JSON.stringify(event);
    console.log('Request body size:', postData.length, 'bytes');
    
    const options = {
        hostname: urlParts.hostname,
        port: 443,
        path: urlParts.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'x-api-key': API_KEY
        },
        timeout: 20000, // 20 seconds timeout
        rejectUnauthorized: true // Enable SSL certificate validation
    };
    
    console.log('Request options:', {
        hostname: options.hostname,
        path: options.path,
        method: options.method,
        headers: {
            ...options.headers,
            'x-api-key': 'hidden'
        }
    });
    
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        console.log('Starting HTTPS request...');
        
        const req = https.request(options, (res) => {
            const responseTime = Date.now() - startTime;
            console.log('Response received in', responseTime, 'ms');
            console.log('Response status code:', res.statusCode);
            console.log('Response headers:', JSON.stringify(res.headers));
            
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log('Response body:', data);
                
                try {
                    const parsedData = JSON.parse(data);
                    console.log('Backend response:', parsedData);
                    
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({
                            statusCode: 200,
                            body: JSON.stringify({
                                success: true,
                                message: 'Event processed successfully',
                                backendResponse: parsedData
                            })
                        });
                    } else {
                        console.error('Backend returned error status:', res.statusCode);
                        resolve({
                            statusCode: res.statusCode,
                            body: JSON.stringify({
                                success: false,
                                message: `Backend returned status ${res.statusCode}`,
                                backendResponse: parsedData
                            })
                        });
                    }
                } catch (parseError) {
                    console.error('Failed to parse response:', parseError);
                    console.error('Raw response:', data);
                    resolve({
                        statusCode: 500,
                        body: JSON.stringify({
                            success: false,
                            message: 'Failed to parse backend response',
                            rawResponse: data
                        })
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            const errorTime = Date.now() - startTime;
            console.error('Request failed after', errorTime, 'ms');
            console.error('Request error:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            
            if (error.code === 'ECONNREFUSED') {
                console.error('Connection refused - backend might be down');
            } else if (error.code === 'ETIMEDOUT') {
                console.error('Request timed out');
            } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
                console.error('SSL certificate issue');
            }
            
            resolve({
                statusCode: 502,
                body: JSON.stringify({
                    success: false,
                    message: 'Failed to connect to backend',
                    error: {
                        code: error.code,
                        message: error.message
                    }
                })
            });
        });
        
        req.on('timeout', () => {
            console.error('Request timeout after 20 seconds');
            req.abort();
            resolve({
                statusCode: 504,
                body: JSON.stringify({
                    success: false,
                    message: 'Request timeout'
                })
            });
        });
        
        // Send the request
        console.log('Sending POST request with body...');
        req.write(postData);
        req.end();
        console.log('Request sent, waiting for response...');
    });
};