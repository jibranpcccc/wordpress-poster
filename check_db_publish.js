const fs = require('fs');
const projectPath = 'c:\\Users\\jibra\\Desktop\\1\\worpdrepss posting\\src\\data\\projects\\proj_1782807855584.json';
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

console.log("Project ID:", project.id);
console.log("Status:", project.status);
console.log("WordPress Settings:", project.wpSettings);
console.log("Selected Categories:", project.selectedCategoryIds);
console.log("Keys in project:", Object.keys(project));
