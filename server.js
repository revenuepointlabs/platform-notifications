require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBEX_ACCESS_TOKEN = process.env.WEBEX_ACCESS_TOKEN;
const WEBEX_ROOM_ID = process.env.WEBEX_ROOM_ID;
const PAGERDUTY_API_KEY = process.env.PAGERDUTY_API_KEY;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Function to fetch the PagerDuty integration key from the database
async function getPagerDutyIntegrationKey(serviceName) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT pagerduty_integration_key FROM pagerduty_services WHERE service_name = $1', [serviceName]);
        if (result.rows.length > 0) {
            return result.rows[0].pagerduty_integration_key;
        } else {
            console.error(`No PagerDuty service key found for service: ${serviceName}`);
            return null;
        }
    } catch (error) {
        console.error('Error querying the database for PagerDuty integration key:', error);
        return null;
    } finally {
        client.release();
    }
}

// Function to send a notification to PagerDuty
async function sendToPagerDuty(event) {
    const serviceKey = await getPagerDutyIntegrationKey(event.service);

    if (!serviceKey) {
        const errorMessage = `No PagerDuty service key found for service: ${event.service}`;
        console.error(errorMessage);
        await storeEvent({
            type: 'system_notifications',
            level: 'warning',
            message: errorMessage,
            service: 'platform-notifications',
            metadata: null
        });
        return;  // Skip sending if no service key is found
    }

    const payload = {
        routing_key: serviceKey,
        event_action: 'trigger',
        payload: {
            summary: `${event.service} - ${event.type}: ${event.message}`,
            severity: event.level,  // Use the level directly as severity
            source: event.service,
            custom_details: event.metadata || {}
        }
    };

    try {
        await axios.post('https://events.pagerduty.com/v2/enqueue', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token token=${PAGERDUTY_API_KEY}`
            }
        });
        console.log(`PagerDuty alert sent for ${event.level} event`);
    } catch (error) {
        console.error('Error sending to PagerDuty:', error.response ? error.response.data : error.message);
    }
}

// Function to send a notification to Webex
async function sendToWebex({ type, level, message, service }) {
    const textToSend = `Service: ${service}\nType: ${type}\nLevel: ${level}\nMessage: ${message}`;
    
    await axios.post('https://webexapis.com/v1/messages', {
        roomId: WEBEX_ROOM_ID,
        text: textToSend,
    }, {
        headers: { Authorization: `Bearer ${WEBEX_ACCESS_TOKEN}` }
    });
}

// Store the platform event in the database
async function storeEvent({ type, level, message, service, metadata }) {
    const client = await pool.connect();
    try {
        const query = 'INSERT INTO platform_events (type, level, message, service, metadata) VALUES ($1, $2, $3, $4, $5)';
        await client.query(query, [type, level, message, service, metadata]);
    } catch (err) {
        console.error('Error inserting event into database:', err);
    } finally {
        client.release();
    }
}

// Function to validate the API key and service match
async function validateApiKeyAndService(apiKey, service) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM api_keys WHERE api_key = $1 AND service_name = $2 AND active = TRUE', [apiKey, service]);
        return result.rows.length > 0;  // True if there's a matching API key and service
    } catch (error) {
        console.error('Error validating API key and service:', error);
        return false;
    } finally {
        client.release();
    }
}

// Function to validate the API key and service match
async function validateApiKeyAndService(apiKey, service) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM api_keys WHERE api_key = $1 AND service_name = $2 AND active = TRUE', [apiKey, service]);
        return result.rows.length > 0;  // True if there's a matching API key and service
    } catch (error) {
        console.error('Error validating API key and service:', error);
        return false;
    } finally {
        client.release();
    }
}

app.post('/platform-event', async (req, res) => {
    const { type, level, message, service, metadata } = req.body;
    const apiKey = req.headers['x-api-key'];  // Get API key from request headers

    // Check if the API key and service match in the database
    if (!apiKey || !(await validateApiKeyAndService(apiKey, service))) {
        const errorMessage = `Invalid API Key or API Key does not match the service: ${service}`;
        console.error(errorMessage);

        // Log the API key error to the database
        await storeEvent({
            type: 'system_notifications',
            level: 'warning',
            message: errorMessage,
            service: 'platform-notifications',
            metadata: { apiKey, service }
        });

        return res.status(403).send({ error: 'Forbidden: Invalid API Key or Service' });
    }

    // Proceed with the rest of the logic if the key and service match
    try {
        // Send to Webex space
        await sendToWebex({ type, level, message, service });

        // Send to PagerDuty if level is error or critical
        if (level === 'error' || level === 'critical') {
            await sendToPagerDuty({ type, level, message, service, metadata });
        }

        // Store event in the database
        await storeEvent({ type, level, message, service, metadata });

        res.send({ success: true, message: 'Platform event processed successfully.' });
    } catch (error) {
        console.error('Error processing platform event:', error);
        res.status(500).send({ error: 'Failed to process platform event' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
