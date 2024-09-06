# Webex Notify - Platform Notification Service

This project is a Node.js application that sends platform notifications to a Webex space and PagerDuty. It stores event details in a PostgreSQL database and supports dynamic routing to different PagerDuty services based on the event's source (`service` field). API key authentication is required for accessing the platform notification service, with each API key tied to a specific service. Severity levels are used to control the urgency of the PagerDuty alerts.

## Features

- Sends platform notifications to a Webex space.
- Sends alerts to different PagerDuty services based on event `service`.
- Dynamically sets the severity level for PagerDuty, which maps to notification urgency.
- Stores event details in a PostgreSQL database.
- Supports `info`, `warning`, `error`, and `critical` severity levels.
- **API key authentication** for securing access to the `/platform-event` endpoint.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [API Key Management](#api-key-management)
- [API Endpoints](#api-endpoints)
- [Running the Application](#running-the-application)
- [How to Use in Another Node.js Application](#how-to-use-in-another-nodejs-application)
  - [Critical Event Example](#1-critical-event-example-system-outage-or-security-breach)
  - [Error Event Example](#2-error-event-example-database-connection-failure)
  - [Warning Event Example](#3-warning-event-example-high-memory-usage)
  - [Info Event Example](#4-info-event-example-routine-system-check-or-startup)
- [Monitoring CPU Usage in a Node.js App and Sending Events to the Notification Service](#monitoring-cpu-usage-in-a-nodejs-app-and-sending-events-to-the-notification-service)
  - [1. Use the `os` Module to Monitor CPU Usage](#1-use-the-os-module-to-monitor-cpu-usage)
  - [2. Set Up CPU Monitoring in Your App](#2-set-up-cpu-monitoring-in-your-app)
    - [Example Code for Monitoring CPU](#example-code-for-monitoring-cpu)
  - [3. How the Code Works](#3-how-the-code-works)
  - [4. Additional Considerations](#4-additional-considerations)
- [Common Event Types for Application Monitoring](#common-event-types-for-application-monitoring)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites

Before running this application, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v14 or later)
- [PostgreSQL](https://www.postgresql.org/) (locally or hosted)
- A Webex access token for sending messages to a Webex space.
- PagerDuty API key and integration keys for each service you want to monitor.
- **API keys** for authentication to access the platform notification service.

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/webex-notify.git
   cd webex-notify
   ```

2. Install the required dependencies:

   ```bash
   npm install
   ```

3. Set up your environment variables (see the [Environment Variables](#environment-variables) section).

## Environment Variables

Create a `.env` file in the root directory of your project and include the following variables:

```bash
WEBEX_ACCESS_TOKEN=your_webex_access_token
WEBEX_ROOM_ID=your_webex_room_id
DATABASE_URL=postgres://your_db_user:your_db_password@localhost:5432/your_db_name
PAGERDUTY_API_KEY=your_pagerduty_api_key
```

- `WEBEX_ACCESS_TOKEN`: The Webex token used to authenticate API requests.
- `WEBEX_ROOM_ID`: The ID of the Webex room where notifications will be sent.
- `DATABASE_URL`: Connection string for your PostgreSQL database.
- `PAGERDUTY_API_KEY`: The PagerDuty API key used to authenticate API requests.

## Database Setup

Ensure PostgreSQL is running and create a new database:

```bash
psql -U postgres -c "CREATE DATABASE your_db_name;"
```

Once connected to your database, create the necessary tables:

### Create the `platform_events` Table:

```sql
CREATE TABLE platform_events (
    id SERIAL PRIMARY KEY,
    type VARCHAR(255) NOT NULL,
    level VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    service VARCHAR(255) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Create the `pagerduty_services` Table:

```sql
CREATE TABLE pagerduty_services (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(255) UNIQUE NOT NULL,
    pagerduty_integration_key VARCHAR(255) NOT NULL
);
```

You can then insert records for each service:

```sql
INSERT INTO pagerduty_services (service_name, pagerduty_integration_key)
VALUES ('auth_service', 'PAGERDUTY_INTEGRATION_KEY_FOR_AUTH'),
       ('payment_service', 'PAGERDUTY_INTEGRATION_KEY_FOR_PAYMENT'),
       ('memory_monitor', 'PAGERDUTY_INTEGRATION_KEY_FOR_MEMORY'),
       ('db_service', 'PAGERDUTY_INTEGRATION_KEY_FOR_DB');
```

### Create the `api_keys` Table:

```sql
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);
```

You can insert records for API keys associated with each service:

```sql
INSERT INTO api_keys (api_key, service_name)
VALUES ('YOUR_GENERATED_API_KEY', 'memory_monitor'),
       ('ANOTHER_API_KEY', 'db_service');
```

## API Key Management

To secure access to the `/platform-event` endpoint, the application requires that each request includes an API key. The API key must be associated with the `service` provided in the request. Only valid API keys are allowed to trigger platform events.

- API keys are stored in the `api_keys` table with a corresponding `service_name`.
- Incoming requests are validated to ensure the provided API key matches the `service` in the request body.

**To generate a new API key**, you can use the following script in Node.js:

```javascript
const crypto = require('crypto');

function generateApiKey() {
    return crypto.randomBytes(32).toString('hex'); // Generates a 64-character API key
}

console.log(generateApiKey());
```

Once generated, you can insert the API key into the `api_keys` table along with the corresponding service.

### Example of Inserting an API Key:

```sql
INSERT INTO api_keys (api_key, service_name)
VALUES ('YOUR_NEW_API_KEY', 'auth_service');
```

## API Endpoints

### POST `/platform-event`

Send a platform notification event to Webex and PagerDuty, and store it in the database. Include an API key in the request headers.

**Request Headers**:

```bash
x-api-key: YOUR_API_KEY
```

**Request Body**:

```json
{
  "type": "system_alert",
  "level": "warning",  // Must be one of: 'info', 'warning', 'error', or 'critical'
  "message": "High memory usage detected",
  "service": "memory_monitor",
  "metadata": {
    "memory_usage": "90%",
    "threshold": "85%"
  }
}
```

- `type` (string): The type of event (e.g., `system_alert`, `performance_alert`).
- `level` (string): The severity level of the event. Must be one of: `critical`, `error`, `warning`, or `info`.
- `message` (string): The message to be sent to Webex and PagerDuty.
- `service` (string): The service that generated the event. This is used to route the event to the correct PagerDuty integration key.
- `metadata` (JSON object, optional): Additional event details.

**Response**:

```json
{
  "success": true,
  "message": "Platform event processed successfully."
}
```

If the provided API key is invalid or does not match the `service`, a `403 Forbidden` response will be returned.

```json
{
  "error": "Forbidden: Invalid API Key or Service"
}
```

## Running the Application

To start the application locally, use the following command:

```bash
npm start
```

The server will start on the specified port (default: 3000). You can now send HTTP POST requests to the `/platform-event` endpoint, ensuring to include a valid API key in the headers.

### Testing the API

Use `curl` or Postman to send POST requests to the `/platform-event` endpoint:

```bash
curl -X POST http://localhost:3000/platform-event \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "type": "system_alert",
        "level": "critical",
        "message": "Database connection failure",
        "service": "db_service",
        "metadata": {
          "connection_attempts": 3
        }
      }'
```

## How to Use in Another Node.js Application

You can integrate this platform notification service into other Node.js applications by sending HTTP POST requests to the `/platform-event` endpoint whenever certain events occur (e.g., exceptions, warnings, or informational logs). **Remember to include the API key in the request headers** for authentication.

Here’s how you can use this notification service with examples for each severity level (`critical`, `error`, `warning`, `info`).

### Required Request Headers:

Include the `x-api-key` header in the request, along with the corresponding API key associated with the service:

```bash
x-api-key: YOUR_API_KEY
```

### Example of Adding the API Key in the Request (for all examples below):

```javascript
const axios = require('axios');

async function sendEvent() {
    await axios.post('http://localhost:3000/platform-event', {
        type: 'system_alert',
        level: 'critical',
        message: 'System outage detected',
        service: 'web_server',
        metadata: { uptime: '99.8%' }
    }, {
        headers: {
            'x-api-key': 'YOUR_API_KEY'
        }
    });
}
```

#### **1. Critical Event Example**: System Outage or Security Breach

For `critical` events, use this level for incidents that require immediate attention, such as a system outage or a security breach.

Example (within another Node.js app):

```javascript
const axios = require('axios');

async function handleSystemOutage() {
    try {
        // Simulate critical system failure
        throw new Error('System outage detected!');
    } catch (err) {
        // Send a critical event notification
        await axios.post('http://localhost:3000/platform-event', {
            type: 'system_alert',
            level: 'critical',
            message: err.message,
            service: 'web_server',
            metadata: {
                uptime: '99.8%',
                time: new Date().toISOString()
            }
        }, {
            headers: {
                'x-api-key': 'YOUR_API_KEY'
            }
        });
        console.error('Critical: System outage reported.');
    }
}

handleSystemOutage();
```

#### **2. Error Event Example**: Database Connection Failure

For `error` events, you might use this level when an exception occurs that isn't critical but still needs attention, such as a failed database connection.

Example (within another Node.js app):

```javascript
const axios = require('axios');

async function handleDatabaseConnection() {
    try {
        // Simulate a database connection failure
        throw new Error('Failed to connect to the database');
    } catch (err) {
        // Send an error event notification
        await axios.post('http://localhost:3000/platform-event', {
            type: 'db_connection_error',
            level: 'error',
            message: err.message,
            service: 'database_service',
            metadata: {
                connection_attempts: 3,
                db_host: 'localhost'
            }
        }, {
            headers: {
                'x-api-key': 'YOUR_API_KEY'
            }
        });
        console.error('Error: Database connection failed.');
    }
}

handleDatabaseConnection();
```

#### **3. Warning Event Example**: High Memory Usage

For `warning` events, use this level to report issues that may not be urgent but could become a problem if ignored. A common example might be high memory usage.

Example (within another Node.js app):

```javascript
const axios = require('axios');

async function monitorMemoryUsage() {
    const memoryUsage = 85; // Example usage percentage

    if (memoryUsage > 80) {
        // Send a warning event notification
        await axios.post('http://localhost:3000/platform-event', {
            type: 'memory_alert',
            level: 'warning',
            message: 'High memory usage detected',
            service: 'memory_monitor',
            metadata: {
                memory_usage: `${memoryUsage}%`,
                threshold: '80%'
            }
        }, {
            headers: {
                'x-api-key': 'YOUR_API_KEY'
            }
        });
        console.warn('Warning: High memory usage detected.');
    }
}

monitorMemoryUsage();
```

#### **4. Info Event Example**: Routine System Check or Startup

For `info` events, use this level to log routine actions or informational events. These are not errors or warnings but help provide context for regular operations, such as starting a service or running scheduled tasks.

Example (within another Node.js app):

```javascript
const axios = require('axios');

async function systemStartup() {
    // Simulate system startup
    console.log('System is starting up...');

    // Send an informational event notification
    await axios.post('http://localhost:3000/platform-event', {
        type: 'system_startup',
        level: 'info',
        message: 'System successfully started',
        service: 'web_server',
        metadata: {
            uptime: '0 days, 0 hours',
            time: new Date().toISOString()
        }
    }, {
        headers: {
            'x-api-key': 'YOUR_API_KEY'
        }
    });

    console.info('Info: System startup completed.');
}

systemStartup();
```

### Usage in Try-Catch Blocks and Event Monitoring

You can use this service in a variety of scenarios, such as:
- **Try-Catch Blocks**: Handle exceptions gracefully by sending `error` or `critical` events to PagerDuty and Webex.
- **Regular Monitoring**: Use `info` events to track normal operations and `warning` events for potential issues that need attention.
- **Critical Incidents**: Use `critical` events for system outages or security breaches that require immediate intervention.

## Monitoring CPU Usage in a Node.js App and Sending Events to the Notification Service

To monitor CPU usage in a Node.js app deployed on Heroku and send events to your notification service, you can use a built-in Node.js package like `os` to periodically check the system's CPU usage and then send alerts to your notification service when it exceeds a threshold.

### 1. Use the `os` Module to Monitor CPU Usage

The `os` module in Node.js provides system-level information, including CPU usage details. You can periodically check the system load averages and set a threshold for alerting.

### 2. Set Up CPU Monitoring in Your App

You can set up a simple periodic check using the `os` module to monitor CPU usage and send alerts to your notification service when CPU usage crosses a certain threshold.

#### Example Code for Monitoring CPU:

```javascript
const axios = require('axios');
const os = require('os');

// Define a threshold for CPU load
const CPU_LOAD_THRESHOLD = 1.0; // Adjust based on the system's average CPU load

// Function to calculate average CPU load
function getAverageCpuLoad() {
    const cpus = os.cpus();
    let userTime = 0;
    let niceTime = 0;
    let sysTime = 0;
    let idleTime = 0;
    let irqTime = 0;

    for (const cpu of cpus) {
        userTime += cpu.times.user;
        niceTime += cpu.times.nice;
        sysTime += cpu.times.sys;
        idleTime += cpu.times.idle;
        irqTime += cpu.times.irq;
    }

    const totalTime = userTime + niceTime + sysTime + idleTime + irqTime;
    const activeTime = totalTime - idleTime;

    // Return the percentage of CPU load
    return (activeTime / totalTime);
}

// Function to check CPU usage and send alert if it exceeds threshold
async function monitorCpuUsage() {
    const cpuLoad = getAverageCpuLoad();

    if (cpuLoad > CPU_LOAD_THRESHOLD) {
        console.warn(`High CPU usage detected: ${cpuLoad.toFixed(2)} > ${CPU_LOAD_THRESHOLD}`);
        // Send a warning event to your notification service
        await axios.post('http://your-notification-service.com/platform-event', {
            type: 'cpu_alert',
            level: 'warning',
            message: `High CPU usage detected: ${cpuLoad.toFixed(2)}`,
            service: 'cpu_monitor',
            metadata: {
                cpu_load: cpuLoad.toFixed(2),
                threshold: CPU_LOAD_THRESHOLD
            }
        });
    } else {
        console.log(`CPU load is within acceptable range: ${cpuLoad.toFixed(2)}`);
    }
}

// Run the monitor function at a set interval
setInterval(monitorCpuUsage, 60000); // Check every 60 seconds
```

### 3. How the Code Works:
1. **Monitor CPU Usage**: 
   - The `getAverageCpuLoad` function uses the `os` module to calculate the average CPU load across all cores.
   - It calculates the CPU load by summing up the time spent by the CPU in various modes (user, nice, system, idle, IRQ).
   
2. **Threshold-Based Alert**:
   - The script checks if the CPU load exceeds a defined threshold (`CPU_LOAD_THRESHOLD`). In this case, `1.0` represents 100% CPU usage.
   
3. **Send Notification**:
   - If the CPU usage exceeds the threshold, it sends a `warning` level event to your notification service using the `cpu_alert` type.

### 4. Additional Considerations:

- **Customizing the Threshold**: You may need to adjust the `CPU_LOAD_THRESHOLD` value depending on the performance and requirements of your app. A threshold of `1.0` means 100% CPU utilization. You might want to lower this depending on the average load your app typically handles.
  
- **Memory Monitoring**: You can also use the `os` module to monitor memory usage with `os.freemem()` and `os.totalmem()` if memory usage is also a concern.

- **Environment Variables**: If you want to dynamically change the threshold or monitoring interval, you can store those in Heroku's environment variables.

```bash
heroku config:set CPU_LOAD_THRESHOLD=1.0 MONITOR_INTERVAL=60000
```

Then, you can use `process.env.CPU_LOAD_THRESHOLD` and `process.env.MONITOR_INTERVAL` in your code to configure the app dynamically.

## Common Event Types for Application Monitoring

| **Type**                | **Description**                                                                                                                                                    | **Severity Level** (Typical) |
|-------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------|
| `system_alert`           | Indicates a major system-wide issue, such as a total application outage or unresponsive system.                                                                    | `critical`                  |
| `db_connection_error`    | Triggered when the application is unable to connect to the database or when a database connection is lost.                                                         | `error`                     |
| `api_failure`            | Represents a failure when calling a third-party API or internal API, typically due to timeouts or invalid responses.                                                | `error` or `warning`         |
| `memory_alert`           | Fired when the application memory usage exceeds a predefined threshold.                                                                                            | `warning`                   |
| `cpu_alert`              | Triggered when CPU usage crosses a critical threshold, which may indicate performance bottlenecks or possible application overload.                                 | `warning`                   |
| `disk_space_warning`     | Indicates that the available disk space is running low and could affect application performance or stability.                                                       | `warning`                   |
| `service_unavailable`    | Signals that a key service or dependency (e.g., caching service, file storage, etc.) is unavailable or not responding correctly.                                    | `critical` or `error`        |
| `security_breach`        | Fired in the case of a suspected or confirmed security breach, such as unauthorized access attempts, or intrusion detection alerts.                                  | `critical`                  |
| `authentication_failure` | Generated when login attempts fail or when there are issues with user authentication, such as invalid tokens or failed OAuth handshakes.                           | `error`                     |
| `payment_error`          | Triggered when a payment or financial transaction fails, possibly due to gateway errors or validation issues.                                                       | `error`                     |
| `slow_response_time`     | Indicates that the application's response time for certain requests is slower than expected, often pointing to performance issues.                                  | `warning` or `info`          |
| `data_loss_event`        | Fired when there is a risk or confirmed instance of data loss (e.g., due to service failure or backup failure).                                                     | `critical`                  |
| `backup_failure`         | Alerts that scheduled backups have failed or encountered errors, putting data at risk.                                                                              | `error` or `critical`        |
| `configuration_change`   | Logged when configuration files or settings are changed in the application. This can be used for audit purposes or tracking issues caused by recent changes.        | `info` or `warning`          |
| `deployment_event`       | Fired when a new application deployment occurs, typically for logging purposes to track when changes have been pushed to production.                                | `info`                      |
| `system_startup`         | Fired when the system or application successfully starts up. Useful for monitoring uptime and system availability.                                                  | `info`                      |
| `system_shutdown`        | Triggered when the system or application is being shut down, intentionally or due to failures.                                                                     | `info` or `warning`          |
| `service_recovery`       | Indicates that a previously down service has been restored or recovered successfully.                                                                               | `info`                      |
| `request_timeout`        | Triggered when a client request to the application exceeds the allowed timeout period, potentially indicating performance issues or overloaded systems.              | `warning` or `error`         |
| `email_failure`          | Fired when email notifications or communications from the application fail, often due to SMTP errors or email service outages.                                      | `error`                     |
| `file_system_error`      | Indicates issues with the file system, such as file read/write errors, permission issues, or failed file operations.                                                | `error`                     |
| `user_signup`            | Logged when a new user signs up or registers in the system. This can be useful for tracking user growth or anomalies in registration.                               | `info`                      |
| `user_deactivation`      | Fired when a user account is deactivated or deleted, either by the user or an administrator.                                                                       | `info`                      |
| `task_failure`           | Represents the failure of a scheduled task or background job (e.g., cron jobs, task queues) that the application relies on for periodic maintenance or updates.      | `error` or `warning`         |
| `cache_eviction`         | Indicates that cache eviction occurred, which may impact application performance if the cache is heavily relied upon for faster data retrieval.                     | `info` or `warning`          |
| `rate_limit_exceeded`    | Triggered when API rate limits are exceeded, either for external APIs or internal services.                                                                         | `warning` or `info`          |
| `high_network_latency`   | Fired when network response times exceed acceptable limits, possibly affecting overall system performance or external service interaction.                           | `warning`                   |
| `queue_overflow`         | Triggered when message queues, task queues, or similar systems become overloaded, which could indicate processing delays.                                            | `warning` or `critical`      |

### How These Types Can Be Used:

1. **System Monitoring**: `system_alert`, `system_startup`, `system_shutdown` — useful for tracking the health and availability of core systems.
2. **Performance Issues**: `cpu_alert`, `memory_alert`, `slow_response_time`, `high_network_latency` — used to catch performance bottlenecks and optimize system performance.
3. **Security Monitoring**: `security_breach`, `authentication_failure` — monitor and respond to potential security threats.
4. **Task/Job Monitoring**: `task_failure`, `backup_failure`, `cache_eviction` — ensure background tasks and scheduled jobs are running as expected.
5. **User and Service Activity**: `user_signup`, `user_deactivation`, `service_unavailable` — monitor user activities, service availability, and application usage patterns.
6. **Data Integrity**: `data_loss_event`, `db_connection_error`, `payment_error`, `file_system_error` — track critical errors related to data handling and integrity.

### Severity Level Guidelines:
- **Critical**: Major incidents that require immediate attention (e.g., `system_alert`, `security_breach`, `data_loss_event`).
- **Error**: Significant issues but not necessarily urgent (e.g., `db_connection_error`, `api_failure`, `authentication_failure`).
- **Warning**: Potential problems that need monitoring but may not yet be urgent (e.g., `memory_alert`, `slow_response_time`, `disk_space_warning`).
- **Info**: Routine events or informational logs (e.g., `system_startup`, `deployment_event`, `user_signup`).

### Customization:
- You can add more types as needed, based on your specific application monitoring needs. Just ensure that your event types are meaningful and consistent across your monitoring system.

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests to improve the project.

### Steps to Contribute:
1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Make your changes.
4. Commit your changes (`git commit -m 'Add new feature'`).
5. Push to your branch (`git push origin feature/your-feature`).
6. Open a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
