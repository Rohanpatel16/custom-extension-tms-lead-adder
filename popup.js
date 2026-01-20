document.addEventListener('DOMContentLoaded', () => {
  const processBtn = document.getElementById('process-btn');
  const leadDataInput = document.getElementById('lead-data');
  const statusLog = document.getElementById('status-log');
  const industrySelect = document.getElementById('industry-select');

  processBtn.addEventListener('click', async () => {
    const rawData = leadDataInput.value;
    if (!rawData.trim()) {
      log('Error: No data provided.', 'error');
      return;
    }

    processBtn.disabled = true;
    log('Parsing data...', 'info');

    try {
      const leads = parseData(rawData);
      log(`Found ${leads.length} leads to process.`, 'info');

      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        log('Error: No active tab found.', 'error');
        processBtn.disabled = false;
        return;
      }

      // Send leads to content script
      log('Sending to content script...', 'info');
      chrome.tabs.sendMessage(tab.id, {
        action: 'PROCESS_LEADS',
        leads: leads,
        globalIndustry: industrySelect.value
      }, (response) => {
        if (chrome.runtime.lastError) {
          log('Error connecting to page: ' + chrome.runtime.lastError.message + '. Refresh the page and try again.', 'error');
          processBtn.disabled = false;
          return;
        }

        if (response && response.status === 'STARTED') {
          log('Automation started on page.', 'success');
        } else {
          log('Unknown response from page.', 'error');
          processBtn.disabled = false;
        }
      });

    } catch (e) {
      log('Parsing Error: ' + e.message, 'error');
      processBtn.disabled = false;
    }
  });

  // Listen for progress updates from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'LOG_UPDATE') {
      log(message.text, message.type);
      if (message.done) {
        processBtn.disabled = false;
        log('Batch processing completed.', 'success');
      }
    }
  });

  function log(text, type = 'normal') {
    const div = document.createElement('div');
    div.className = 'log-entry log-' + type;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.innerText = new Date().toLocaleTimeString('en-US', { hour12: false });

    const msgSpan = document.createElement('span');
    msgSpan.className = 'message';
    msgSpan.innerText = text;

    div.appendChild(timeSpan);
    div.appendChild(msgSpan);

    statusLog.prepend(div);
  }

  function parseData(text) {
    const lines = text.split('\n');
    const leadsByCompany = {};
    const processedEmails = new Set();
    let currentCompany = '';

    // 1. Parsing and Grouping Phase
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.includes('@')) {
        // Lead data
        let email, mobilePart;

        // Handle lines without separator or with weird spacing
        if (line.includes(': :')) {
          [email, mobilePart] = line.split(': :');
        } else if (line.includes(':')) {
          // Fallback for simple single colon
          [email, mobilePart] = line.split(':');
        } else {
          // Just email
          email = line;
          mobilePart = '';
        }

        email = email.trim().toLowerCase();

        // Deduplication Check
        if (processedEmails.has(email)) {
          log(`Duplicate skipped: ${email}`, 'info');
          continue;
        }
        processedEmails.add(email);

        // Mobile cleanup
        let mobile = '';
        if (mobilePart) {
          // "91 87794 73221, 91 88282 51345"
          // Ignore garbage like "#ERROR!"
          if (!mobilePart.includes('ERROR') && !mobilePart.includes('error')) {
            let numbers = mobilePart.split(/[,/]/); // Split by comma or slash
            if (numbers.length > 0) {
              // Take first number, clean it
              // Allow digits, plus. Remove spaces, dashes, parens
              let rawNum = numbers[0].trim();
              let cleanNum = rawNum.replace(/[^\d+]/g, '');
              if (cleanNum.length > 5) { // Simple validation
                mobile = cleanNum;
              }
            }
          }
        }

        let contactPerson = '';
        if (email.includes('@')) {
          let userPart = email.split('@')[0];
          contactPerson = userPart.replace(/[._]/g, ' ');
          contactPerson = contactPerson.replace(/\b\w/g, l => l.toUpperCase());
        }

        if (currentCompany) {
          if (!leadsByCompany[currentCompany]) {
            leadsByCompany[currentCompany] = [];
          }
          leadsByCompany[currentCompany].push({
            email: email,
            mobile: mobile,
            contact_person: contactPerson,
            original_line: line
          });
        } else {
          // Fallback: Driver company from email domain if no header found yet
          // e.g. user@ethicsgroup.in -> ethicsgroup.in
          if (email.includes('@')) {
            const domain = email.split('@')[1];
            if (domain) {
              if (!leadsByCompany[domain]) {
                leadsByCompany[domain] = [];
              }
              leadsByCompany[domain].push({
                email: email,
                mobile: mobile,
                contact_person: contactPerson,
                original_line: line
              });
              // Note: We don't set currentCompany here globally to avoid accidentally grouping unrelated subsequent leads 
              // if the user intended a break, but for this specific lead we use its domain.
              // Actually, usually leads are grouped. Let's set it if it looks safe?
              // Let's just group under this domain for this item.
            }
          }
        }

      } else {
        // Company Header?
        // Logic: Must contain a dot to be a domain (e.g. "ethicsgroup.in"). 
        // Ignore lines like "Batch 1", "Batch 2" which caused issues.
        if (line.includes('.')) {
          currentCompany = line;
        }
      }
    }

    // 2. Batching Phase (Chunks of 5)
    // Structure: One "Main" lead, and up to 4 "Extra" leads in the requirements box.
    const batches = [];

    for (const [company, leads] of Object.entries(leadsByCompany)) {
      // Chunk array into size 5
      for (let i = 0; i < leads.length; i += 5) {
        const chunk = leads.slice(i, i + 5);
        const mainLead = chunk[0];

        // 1. Emails: Join all 5 with comma and space
        const combinedEmails = chunk.map(l => l.email).join(', ');

        // 2. Mobile: Find the first non-empty mobile in this chunk
        const representativeMobile = chunk.find(l => l.mobile && l.mobile.length > 0)?.mobile || '';

        // 3. Requirements: Keep full list
        const requirementsText = chunk.map(l => `${l.email} : ${l.mobile}`).join('\n');

        batches.push({
          company: company,
          email: combinedEmails,
          mobile: representativeMobile, // Use found mobile, or empty string
          contact_person: mainLead.contact_person,
          requirements: requirementsText
        });
      }
    }

    return batches;
  }

});
