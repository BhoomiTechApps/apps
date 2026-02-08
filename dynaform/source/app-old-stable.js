let survey = {
    title: "",
    questions: []
};

function addQuestion() {
    let text = document.getElementById("questionText").value;
    let type = document.getElementById("questionType").value;
    let options = document.getElementById("options").value
        .split("\n")
        .map(o => o.trim())
        .filter(o => o !== "");
    let min = document.getElementById("minValue").value;
    let max = document.getElementById("maxValue").value;
    let minDate = document.getElementById("minDate").value;
    let maxDate = document.getElementById("maxDate").value;
    if (type !== "pagebreak" && !text) {
        alert("Please enter a question");
        return;
    }
    let question = {
        text: text,
        type: type,
        options: options,
        required: document.getElementById("isRequired").checked
    };
    document.getElementById("isRequired").checked = false;
    if (type === "number") {
        question.min = min ? Number(min) : null;
        question.max = max ? Number(max) : null;
    }
    if (type === "date") {
        question.minDate = minDate || null;
        question.maxDate = maxDate || null;
    }
    if (type === "gps" || type === "image") {   
    }
    survey.questions.push(question);
    resetFields();
    generatePreview();
}

function resetFields() {
    document.getElementById("questionText").value = "";
    document.getElementById("options").value = "";
    document.getElementById("minValue").value = "";
    document.getElementById("maxValue").value = "";
    document.getElementById("minDate").value = "";
    document.getElementById("maxDate").value = "";
}

function deleteQuestion(index) {
    survey.questions.splice(index, 1);
    generatePreview();
}

function editQuestion(index) {
    let q = survey.questions[index];
    document.getElementById("questionText").value = q.text;
    document.getElementById("questionType").value = q.type;
    document.getElementById("options").value = q.options.join("\n");
    document.getElementById("isRequired").checked = q.required;
    if (q.type === "number") {
        document.getElementById("minValue").value = q.min ?? "";
        document.getElementById("maxValue").value = q.max ?? "";
    }
    if (q.type === "date") {
        document.getElementById("minDate").value = q.minDate ?? "";
        document.getElementById("maxDate").value = q.maxDate ?? "";
    }
    survey.questions.splice(index, 1);
    generatePreview();
}

function generatePreview() {
    survey.title = document.getElementById("surveyTitle").value;
    let twoColumn = document.getElementById("twoColumn").checked;
    let html = `<h2>${survey.title}</h2>`;
    html += `
        <div id="previewEditModeContainer">
            <label>
                <input type="checkbox" id="previewEditMode"> Edit Mode
            </label>
        </div>
    `;
    html += `<form id="surveyForm" class="${twoColumn ? 'two-column' : 'one-column'}" onsubmit="return submitResponses(event)">`;
    survey.questions.forEach((q, index) => {
        if (q.type === "pagebreak") {
            html += `<div class="pagebreak"></div>`;
            return;
        }
		html += `<div class="question-block" draggable="false" data-index="${index}">`;
        let requiredMark = q.required ? `<span style="color:red"> *</span>` : "";
            html += `<label>${index + 1}. ${q.text}${requiredMark}</label>`;
        let req = q.required ? "required" : "";
        if (q.type === "text") {
            html += `<input type="text" id="text${index}" ${req}>`;
        }
        if (q.type === "textarea") {
            html += `<textarea id="textarea${index}" ${req}></textarea>`;
        }
        if (q.type === "email") {
            html += `<input type="email" id="email${index}" ${req}>
                     <span class="error" id="error${index}"></span>`;
        }
        if (q.type === "number") {
            let minAttr = q.min !== null ? `min="${q.min}"` : "";
            let maxAttr = q.max !== null ? `max="${q.max}"` : "";
            html += `<input type="number" id="number${index}" ${minAttr} ${maxAttr} ${req}>
                     <span class="error" id="error${index}"></span>`;
            if (q.min || q.max) {
                html += `<small>Range: ${q.min ?? "-âˆž"} to ${q.max ?? "âˆž"}</small>`;
            }
        }
        if (q.type === "date") {
            let minAttr = q.minDate ? `min="${q.minDate}"` : "";
            let maxAttr = q.maxDate ? `max="${q.maxDate}"` : "";
            html += `<input type="date" id="date${index}" ${minAttr} ${maxAttr} ${req}>
                     <span class="error" id="error${index}"></span>`;
            if (q.minDate || q.maxDate) {
                html += `<small>Range: ${q.minDate ?? "Any"} to ${q.maxDate ?? "Any"}</small>`;
            }
        }
        if (q.type === "phone") {
            html += `<input type="text" id="phone${index}" placeholder="+919401065598" ${req}>
                     <span class="error" id="error${index}"></span>`;
        }
        if (q.type === "radio") {
            html += `<div class="radio-group">`;
              q.options.forEach(opt => {
            html += `<label><input type="radio" name="q${index}" ${req}> ${opt}</label>`;
          });
          html += `</div>`;
        }
        if (q.type === "checkbox") {
            html += `<div class="checkbox-group">`;
              q.options.forEach(opt => {
            html += `<label><input type="checkbox" data-q="${index}"> ${opt}</label>`;
          });
          html += `</div>`;
        }
		if (q.type === "dropdown") {
            html += `<select id="dropdown${index}" ${req}>`;
            html += `<option value="">-- Select --</option>`;
              q.options.forEach(opt => {
              html += `<option value="${opt}">${opt}</option>`;
            });
            html += `</select>`;
        }
		if (q.type === "gps") {
            html += `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button type="button" onclick="captureGPS(${index})">Get Current Location</button>
            <input type="text" id="gpslat${index}" placeholder="Latitude" readonly ${req} style="max-width:120px;">
            <input type="text" id="gpslng${index}" placeholder="Longitude" readonly ${req} style="max-width:120px;">
            <input type="text" id="gpsacc${index}" placeholder="Accuracy (m)" readonly style="max-width:120px;">
            </div>`;
        }
        if (q.type === "image") {
            html += `<div>
                <input type="file" id="image${index}" accept="image/*" ${req}>
            </div>`;
        }
        html += `
        <div class="actions">
            <button type="button" onclick="editQuestion(${index})">Edit</button>
            <button type="button" onclick="deleteQuestion(${index})">Delete</button>
        </div>`;
        html += `</div>`;
    });
    html += `
      <div class="form-actions">
        <button type="submit">Submit Survey</button>
      </div>`;
    html += `</form>`;
    document.getElementById("previewArea").innerHTML = html;
    const previewCheckbox = document.getElementById("previewEditMode");
    previewCheckbox.addEventListener("change", () => {
    const enabled = previewCheckbox.checked;
    document.querySelectorAll("#previewArea .question-block").forEach(block => {
        block.draggable = enabled;
        if (enabled) {
            block.classList.add("draggable-enabled");
        } else {
            block.classList.remove("draggable-enabled");
        }
      });
    });
	previewCheckbox.addEventListener("change", () => {
    const show = previewCheckbox.checked;
    document.querySelectorAll("#previewArea .actions").forEach(a => {
        a.style.display = show ? "flex" : "none";
      });
    });
enableDragAndDrop();
}

function enableDragAndDrop() {
    let dragged = null;
    document.querySelectorAll("#previewArea .question-block").forEach(block => {
        block.addEventListener("dragstart", function (e) {
            dragged = this;
            this.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        block.addEventListener("dragend", function () {
            this.classList.remove("dragging");
        });
        block.addEventListener("dragover", function (e) {
            e.preventDefault();
            this.classList.add("drag-over");
        });
        block.addEventListener("dragleave", function () {
            this.classList.remove("drag-over");
        });
        block.addEventListener("drop", function (e) {
            e.preventDefault();
            this.classList.remove("drag-over");
            if (dragged && dragged !== this) {
                let container = document.querySelector("#previewArea form");
                let blocks = Array.from(container.querySelectorAll(".question-block"));
                let fromIndex = blocks.indexOf(dragged);
                let toIndex = blocks.indexOf(this);
                if (fromIndex < toIndex) {
                    container.insertBefore(dragged, this.nextSibling);
                } else {
                    container.insertBefore(dragged, this);
                }
                let movedItem = survey.questions.splice(fromIndex, 1)[0];
                survey.questions.splice(toIndex, 0, movedItem);
                generatePreview();
            }
        });
    });
}

function validateForm() {
    let isValid = true;
    survey.questions.forEach((q, index) => {
        let errorSpan = document.getElementById(`error${index}`);
        if (!errorSpan) return;
        errorSpan.innerHTML = "";
        if (q.type === "email") {
            let email = document.getElementById(`email${index}`).value;
            let emailPattern = /^[^ ]+@[^ ]+\.[a-z]{2,3}$/;
            if (!emailPattern.test(email)) {
                errorSpan.innerHTML = "Invalid Email Address";
                isValid = false;
            }
        }
        if (q.type === "phone") {
            let phone = document.getElementById(`phone${index}`).value;
            let phonePattern = /^\+\d{10,15}$/;
            if (!phonePattern.test(phone)) {
                errorSpan.innerHTML = "Phone must be like +919401065598";
                isValid = false;
            }
        }
        if (q.type === "number") {
            let num = document.getElementById(`number${index}`).value;
            if (q.min !== null && num < q.min) {
                errorSpan.innerHTML = `Minimum allowed is ${q.min}`;
                isValid = false;
            }
            if (q.max !== null && num > q.max) {
                errorSpan.innerHTML = `Maximum allowed is ${q.max}`;
                isValid = false;
            }
        }
		if (q.type === "image" && q.required) {
            let el = document.getElementById(`image${index}`);
            if (!el || el.files.length === 0) {
                alert("Please upload required image: " + q.text);
                isValid = false;
            }
        }
    });
    if (!isValid) alert("Please correct errors before submitting");
    return isValid;
}

async function downloadHTML() {
    const preview = document.getElementById("previewArea");
    const clone = preview.cloneNode(true);
    let formTag = clone.querySelector("form");
    if (formTag) {
        formTag.setAttribute("onsubmit", "return submitResponses(event)");
    }
    clone.querySelectorAll(".actions").forEach(a => a.remove());
    const content = clone.innerHTML;
    const minifiedCSS = `
        body, input, select, textarea, button { font-size:13px; font-family:'Segoe UI',Arial,sans-serif; margin:0; }
        body { background:#f1f3f6; }
        button { padding:8px 13px; border-radius:6px; border:none; background:#2d7ff9; color:#fff; cursor:pointer; font-size:13px; }
        button:hover { background:#1b64d1; }
        form { width:75%; margin:auto; background:#fff; padding:10px; border-radius:10px; border:1px solid #e0e0e0; }
        .question-block { background:#fafafa; padding:13px 15px; margin-bottom:13px; border-radius:8px; border:1px solid #eaeaea; display:flex; align-items:center; gap:13px; flex-wrap:wrap; }
        .question-block label { flex:1; min-width:180px; font-weight:700; }
        .question-block input, .question-block select, .question-block textarea { flex:2; width:100%; min-width:120px; padding:8px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box; }
        .error { color:red; font-size:13px; width:100%; margin-top:5px; }
    `;
    let cssText = minifiedCSS;
    try {
        const response = await fetch("style.css");
        if (response.ok) cssText = await response.text();
    } catch (e) {
        console.log("Using fallback CSS");
    }
    const embeddedScript = `
<script>
let responses = [];
function validateForm() {
    return true;
}
function captureGPS(index) {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by this browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            document.getElementById("gpslat" + index).value = pos.coords.latitude;
            document.getElementById("gpslng" + index).value = pos.coords.longitude;
            document.getElementById("gpsacc" + index).value = pos.coords.accuracy;
        },
        function (err) {
            alert("Unable to get location: " + err.message);
        }
    );
}
async function submitResponses(event) {
    event.preventDefault();
    const form = document.getElementById("surveyForm");
    let formData = {};
    let googleData = new FormData();
    let blocks = form.querySelectorAll(".question-block");
    let fileReadPromises = [];
    for (let i = 0; i < blocks.length; i++) {
        let block = blocks[i];
        let label = block.querySelector("label");
        let questionText = label ? label.innerText : "Question " + (i + 1);
        let answer = "";
        let lat = block.querySelector("input[id^='gpslat']");
        let lng = block.querySelector("input[id^='gpslng']");
        if (lat && lng) {
            let acc = block.querySelector("input[id^='gpsacc']");
            answer = lat.value && lng.value
                ? lat.value + ", " + lng.value + " (Accuracy: " + (acc ? acc.value : "") + "m)"
                : "Not answered";
            formData[questionText] = answer;
            googleData.append(questionText, answer);
            continue;
        }
        let fileInput = block.querySelector("input[type='file']");
        if (fileInput) {
            if (fileInput.files.length > 0) {
                let file = fileInput.files[0];
                answer = file.name;
                let promise = new Promise((resolve) => {
                    let reader = new FileReader();
                    reader.onload = function () {
                        let base64 = reader.result.split(",")[1];
                        googleData.append("image_" + i, base64);
                        googleData.append("filename_" + i, file.name);
                        resolve();
                    };
                    reader.readAsDataURL(file);
                });
                fileReadPromises.push(promise);
            } else {
                answer = "No image uploaded";
            }
            formData[questionText] = answer;
            googleData.append(questionText, answer);
            continue;
        }
        let input = block.querySelector("input, textarea, select");
        if (!input) continue;
        if (["text","date","number","email"].includes(input.type) ||
            ["textarea","select"].includes(input.tagName.toLowerCase())) {
            answer = input.value || "Not answered";
        } else if (input.type === "radio") {
            let checked = block.querySelector("input[type=radio]:checked");
            answer = checked ? checked.nextSibling.textContent.trim() : "Not answered";
        } else if (input.type === "checkbox") {
            let checks = block.querySelectorAll("input[type=checkbox]");
            let values = [];
            checks.forEach(c => {
                if (c.checked) values.push(c.nextSibling.textContent.trim());
            });
            answer = values.length ? values.join(", ") : "Not answered";
        }
        formData[questionText] = answer;
        googleData.append(questionText, answer);
    }
    googleData.append("Timestamp", new Date().toLocaleString());
    responses.push(formData);
    let text = "Survey Title: " + document.title + "\\n";
    text += "Submitted At: " + new Date().toLocaleString() + "\\n\\n";
    for (let key in formData) {
        text += key + " : " + formData[key] + "\\n";
    }
    let blob = new Blob([text], { type: "text/plain" });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey-response-" + Date.now() + ".txt";
    a.click();
    await Promise.all(fileReadPromises);
    fetch("https://script.google.com/macros/s/AKfycbxbpP3pq_urYIIXngxbUHFdfYKEDHjmdnNC3aCs7YYOIP8R-1i4DFqyayASkFHyUchu/exec", {
        method: "POST",
        mode: "no-cors",
        body: googleData
    });
    alert("Response saved and sent successfully!");
    form.reset();
    return false;
}
</script>
`;
    const fullHTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${document.getElementById("surveyTitle").value}</title>
    <style>${cssText}</style>
</head>
<body>
    ${content}
    ${embeddedScript}
</body>
</html>
`;
    const blob = new Blob([fullHTML], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey.html";
    a.click();
    URL.revokeObjectURL(a.href);
}

function downloadPDF() {
    let element = document.getElementById("previewArea");
    let oldClass = element.className;
    element.className = "one-column";
    html2pdf()
        .from(element)
        .save("survey.pdf")
        .then(() => {
            element.className = oldClass;
        });
}

function saveSurveyJSON() {
    let blob = new Blob([JSON.stringify(survey, null, 2)], {
        type: "application/json"
    });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey.json";
    a.click();
}

function loadSurveyJSON(event) {
    let file = event.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function(e) {
        try {
            survey = JSON.parse(e.target.result);
            document.getElementById("surveyTitle").value = survey.title;
            generatePreview();
            alert("Survey loaded successfully!");
        } catch (err) {
            alert("Invalid survey JSON file");
        }
    };
    reader.readAsText(file);
}
let responses = [];

async function submitResponses(event) {
    event.preventDefault();
    if (!validateForm()) return false;
    let formData = {};
    let googleData = new FormData();
    let fileReadPromises = [];
    for (let index = 0; index < survey.questions.length; index++) {
        let q = survey.questions[index];
        if (q.type === "pagebreak") continue;
        let value = "";
        switch(q.type) {
            case "text":
            case "textarea":
            case "number":
            case "date":
            case "email":
            case "phone":
            case "dropdown":
                {
                    let el = document.querySelector(`#surveyForm [id$="${index}"]`);
                    value = el ? el.value.trim() : "Not answered";
                }
                break;
            case "radio":
                {
                    let checked = document.querySelector(`input[name='q${index}']:checked`);
                    value = checked ? checked.nextSibling.textContent.trim() : "Not answered";
                }
                break;
            case "checkbox":
                {
                    let checks = document.querySelectorAll(`#surveyForm input[type='checkbox'][data-q='${index}']`);
                    let selected = [];
                    checks.forEach(c => {
                        if (c.checked) selected.push(c.nextSibling.textContent.trim());
                    });
                    value = selected.length ? selected.join(" | ") : "Not answered";
                }
                break;
            case "gps":
                {
                    let lat = document.getElementById(`gpslat${index}`);
                    let lng = document.getElementById(`gpslng${index}`);
                    let acc = document.getElementById(`gpsacc${index}`);

                    value = (lat && lng) ?
                        lat.value + ", " + lng.value + " (Accuracy: " + (acc ? acc.value : "") + "m)"
                        : "Not answered";
                }
                break;
            case "image":
                {
                    let el = document.getElementById(`image${index}`);
                    if (el && el.files.length > 0) {
                        let file = el.files[0];
                        value = file.name;
                        let promise = new Promise((resolve) => {
                            let reader = new FileReader();
                            reader.onload = function () {
                                let base64 = reader.result.split(",")[1];
                                googleData.append("image_" + index, base64);
                                googleData.append("filename_" + index, file.name);
                                resolve();
                            };
                            reader.readAsDataURL(file);
                        });
                        fileReadPromises.push(promise);
                    } else {
                        value = "No image uploaded";
                    }
                }
                break;
            default:
                value = "Not answered";
        }
        formData[q.text] = value;
        googleData.append(q.text, value);
    }
    googleData.append("Timestamp", new Date().toLocaleString());
    responses.push(formData);
	let text = "Survey Title: " + survey.title + "\nSubmitted At: " + new Date().toLocaleString() + "\n\n";
    for (let key in formData) {
        text += key + " : " + formData[key] + "\n";
    }
    let blob = new Blob([text], { type: "text/plain" });
    let a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "survey-response-" + Date.now() + ".txt";
        a.click();	
    await Promise.all(fileReadPromises);
    sendToGoogle(googleData);
    alert("Response saved and sent successfully!");
    document.getElementById("surveyForm").reset();
    return false;
}

function sendToGoogle(formData) {
    return fetch("https://script.google.com/macros/s/AKfycbxbpP3pq_urYIIXngxbUHFdfYKEDHjmdnNC3aCs7YYOIP8R-1i4DFqyayASkFHyUchu/exec", {
        method: "POST",
        mode: "no-cors",
        body: formData
    });
}

function captureGPS(index) {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by this browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            document.getElementById("gpslat" + index).value = pos.coords.latitude;
            document.getElementById("gpslng" + index).value = pos.coords.longitude;
            document.getElementById("gpsacc" + index).value = pos.coords.accuracy;
        },
        function (err) {
            alert("Unable to get location: " + err.message);
        }
    );
}

// ----------- SUBMISSION PARSER AND VIEWER ------------

function parseSubmissionText(text) {
    let lines = text.split(/\r?\n/);
    let result = {
        surveyTitle: "",
        submittedAt: "",
        fields: []
    };
    let currentField = null;
    for (let line of lines) {
        line = line.trim();
        if (line === "") continue;
        if (line.startsWith("Survey Title:")) {
            result.surveyTitle = line.replace("Survey Title:", "").trim();
            continue;
        }
        if (line.startsWith("Submitted At:")) {
            result.submittedAt = line.replace("Submitted At:", "").trim();
            continue;
        }
        if (line.startsWith("Upload Photo")) {
            currentField = null;
            continue;
        }
        if (line.includes(" : ")) {
            let parts = line.split(" : ");
            let label = parts[0].trim();
            let value = parts.slice(1).join(" : ").trim();
            currentField = {
                label: label,
                value: value
            };
            result.fields.push(currentField);
        } else {
            if (currentField) {
                currentField.value += " " + line;
            }
        }
    }
    return result;
}

function loadSubmission() {
    let input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt";
    input.multiple = true;
    input.onchange = function(event) {
        let files = event.target.files;
        let submissions = [];
        let readCount = 0;
        for (let file of files) {
            let reader = new FileReader();
            reader.onload = function(e) {
                let text = e.target.result;
                let parsed = parseSubmissionText(text);
                submissions.push(parsed);
                readCount++;
                if (readCount === files.length) {
					window.loadedSubmissions = submissions;
                    showSubmissionsTable(submissions);
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

function showSubmissionsTable() {
    let popup = window.open("", "Submissions", "width=900,height=600");
    let html = `
        <html>
        <head>
            <title>Form Submissions</title>
            <style>
                body { font-family: Arial; padding: 10px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
                th { background: #f2f2f2; }
                button { padding: 6px; margin: 4px; }
            </style>
        </head>
        <body>
        <h3>Parsed Submissions</h3>
        <table>
            <tr>
                <th>Survey Title</th>
                <th>Submitted At</th>
                <th>Data</th>
                <th>Action</th>
            </tr>
    `;
    window.loadedSubmissions.forEach((sub, index) => {
        let fieldText = sub.fields
            .map(f => `<b>${f.label}</b>: ${f.value}`)
            .join("<br>");
        html += `
            <tr>
                <td>${sub.surveyTitle}</td>
                <td>${sub.submittedAt}</td>
                <td>${fieldText}</td>
                <td>
                    <button onclick="uploadParsedSubmission(${index})">
                        Send to Google Sheet
                    </button>
                </td>
            </tr>
        `;
    });
    html += `
        </table>
        <script>
        // copy data into popup scope
        window.submissions = ${JSON.stringify(window.loadedSubmissions)};
       function uploadParsedSubmission(index) {

            let sub = window.submissions[index];
            let payload = {
                "Survey Title": sub.surveyTitle,
                "Submitted At": sub.submittedAt
            };
            sub.fields.forEach(f => {
                payload[f.label] = f.value;
            });
            console.log("Sending payload:", payload);
            fetch("https://script.google.com/macros/s/AKfycbx8UsKCFuViyT_Gdcv6OtpRUv4HFd6x2sgb1hLvhyPagT0iego7D6ZTIIi66jBe0_cc/exec", {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            })
            .then(() => {
                alert("Submission sent to Google Sheet successfully (request sent)");
            })
            .catch(err => {
                alert("Error sending to Google: " + err);
                console.log(err);
            });
        }
        </script>
        </body>
        </html>
    `;
    popup.document.write(html);
}


