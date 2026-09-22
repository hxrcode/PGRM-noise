const presets = {

"L-Acoustics Contour": `
20 12
40 12
60 10
100 5
200 0
1000 0
2000 -0.5
5000 -2
10000 -3.5
20000 -6
`,

"Flat": `
20 0
40 0
60 0
100 0
200 0
1000 0
2000 0
5000 0
10000 0
20000 0
`,

"Techno": `
20 6
40 5
60 4
100 2
200 0
1000 0
2000 -1
5000 -2
10000 -3
20000 -5
`,

"Darkwave": `
20 -2
40 0
60 2
100 2
200 1
1000 0
2000 0
5000 -1
10000 -2
20000 -5
`,

"Post-Punk": `
20 -5
40 -3
60 -1
100 0
200 1
1000 0
2000 0
5000 1
10000 0
20000 -4
`,

"Synthwave": `
20 2
40 2
60 2
100 1
200 0
1000 0
2000 1
5000 0
10000 -2
20000 -5
`
};

const textarea = document.getElementById("curveData");

const chart = new Chart(
document.getElementById("curveChart"),
{
type:"line",
data:{
labels:[],
datasets:[{
label:"Target Curve",
data:[],
tension:0.25
}]
},
options:{
responsive:true,
maintainAspectRatio:false
}
}
);

function updateChart(){

const lines =
textarea.value
.trim()
.split("\n");

const x=[];
const y=[];

lines.forEach(line=>{

const p=line.trim().split(/\s+/);

if(p.length>=2){

x.push(Number(p[0]));
y.push(Number(p[1]));

}

});

chart.data.labels=x;
chart.data.datasets[0].data=y;
chart.update();
}

document
.getElementById("loadPreset")
.onclick=()=>{

const name=
document.getElementById("presetSelect").value;

textarea.value=presets[name];

updateChart();
};

textarea.addEventListener(
"input",
updateChart
);

document
.getElementById("downloadTxt")
.onclick=()=>{

const blob =
new Blob(
[textarea.value],
{type:"text/plain"}
);

const a =
document.createElement("a");

a.href=
URL.createObjectURL(blob);

a.download="target_curve.txt";

a.click();
};

let generatedBlob=null;

document
.getElementById("generateNoise")
.onclick=()=>{

const sr=48000;
const duration=30;

const length=
sr*duration;

const buffer=
new Float32Array(length);

for(let i=0;i<length;i++){

buffer[i]=
(Math.random()*2-1)*0.1;

}

let peak=0;

for(let i=0;i<length;i++){

peak=
Math.max(
peak,
Math.abs(buffer[i])
);

}

const gain=
0.125/peak;

for(let i=0;i<length;i++){

buffer[i]*=gain;

}

const wav=
floatToWav(buffer,sr);

generatedBlob=
new Blob(
[wav],
{type:"audio/wav"}
);

alert("Ruido generado.");
};

document
.getElementById("downloadWav")
.onclick=()=>{

if(!generatedBlob){

alert("Genera ruido primero");
return;
}

const a=
document.createElement("a");

a.href=
URL.createObjectURL(
generatedBlob
);

a.download=
"target_noise.wav";

a.click();
};

function floatToWav(samples,sampleRate){

const buffer=
new ArrayBuffer(
44+samples.length*2
);

const view=
new DataView(buffer);

writeString(view,0,"RIFF");

view.setUint32(
4,
36+samples.length*2,
true
);

writeString(view,8,"WAVE");

writeString(view,12,"fmt ");

view.setUint32(16,16,true);
view.setUint16(20,1,true);
view.setUint16(22,1,true);

view.setUint32(
24,
sampleRate,
true
);

view.setUint32(
28,
sampleRate*2,
true
);

view.setUint16(32,2,true);
view.setUint16(34,16,true);

writeString(view,36,"data");

view.setUint32(
40,
samples.length*2,
true
);

let offset=44;

for(let i=0;i<samples.length;i++){

let s=
Math.max(
-1,
Math.min(
1,
samples[i]
)
);

view.setInt16(
offset,
s<0?
s*32768:
s*32767,
true
);

offset+=2;
}

return buffer;
}

function writeString(
view,
offset,
str
){
for(let i=0;i<str.length;i++){
view.setUint8(
offset+i,
str.charCodeAt(i)
);
}
}

textarea.value =
presets["L-Acoustics Contour"];

updateChart();
