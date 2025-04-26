document.getElementById('authButton').addEventListener('click', authenticate);

async function authenticate() {
  try {
    const result = await chrome.identity.getAuthToken({ 
      interactive: true
    });
    
    console.log('Auth result:', result);
    if (result && result.token) {
      console.log('Got token:', result.token);
      await listSpreadsheets(result.token);
    } else {
      console.log('Got raw token:', result);
      await listSpreadsheets(result);
    }
  } catch (error) {
    console.error('Authentication error:', error);
  }
}

async function listSpreadsheets(token) {
  try {
    console.log('Using token:', token);
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?' +
      'q=mimeType=\'application/vnd.google-apps.spreadsheet\' and trashed=false&' +
      'fields=files(id,name)',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      throw new Error(`API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('Fetched spreadsheets:', data);
    displaySpreadsheets(data.files);
  } catch (error) {
    console.error('Error fetching spreadsheets:', error);
    const container = document.getElementById('spreadsheetList');
    container.innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

function displaySpreadsheets(spreadsheets) {
  const container = document.getElementById('spreadsheetList');
  container.innerHTML = '';

  if (!spreadsheets || spreadsheets.length === 0) {
    const noSheets = document.createElement('p');
    noSheets.textContent = 'No spreadsheets found.';
    container.appendChild(noSheets);
    return;
  }

  spreadsheets.forEach(sheet => {
    const div = document.createElement('div');
    div.className = 'spreadsheet-item';
    div.textContent = sheet.name;
    div.dataset.id = sheet.id;
    div.addEventListener('click', () => selectSpreadsheet(sheet));
    container.appendChild(div);
  });
}

function selectSpreadsheet(sheet) {
  chrome.storage.sync.set({ 
    selectedSpreadsheet: {
      id: sheet.id,
      name: sheet.name
    }
  }, () => {
    window.close();
  });
}
