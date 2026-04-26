/*
#define TFT_MOSI 23
#define TFT_SCLK 18
#define TFT_CS   15  // Chip select control pin
#define TFT_DC   25  // Data Command control pin
#define TFT_RST   4  // Reset pin (could connect to RST pin)
*/


#include <TFT_eSPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Servo.h>

#include "greenonline.h"// #include "fieldlevel.h" contains the pixel data for the background image (240x280px)
#include "greenoffline.h"

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);

Servo gate;


const char* ssid = "Agri_IoT";//Agri_IoT
const char* password = "Agri@123";//Agri@123
WebServer server(80);


// 🔥 Static IP settings
IPAddress local_IP(192, 168, 0, 7);   // choose free IP (192, 168, 0, ??) green house
IPAddress gateway(192, 168, 0, 255);      // from ipconfig (192, 168, 0, 255)
IPAddress subnet(255, 255, 255, 0); //(255, 255, 255, 0)

#define IMG_W 240// Image width in pixels
#define IMG_H 280// Image height in pixels


#define HEX565(c) tft.color565((c>>16)&0xFF, (c>>8)&0xFF, c&0xFF)// Convert 24-bit RGB color to 16-bit RGB565 format
#define WATER_COLOR HEX565(0x5BC0EB)// Light Blue (Water)
#define MOIST_COLOR HEX565(0x019b03)// Dark Green (Soil Moisture)


#define gatePin 27 //servo motor
#define getesensor 34 // ir sensor pin
#define firesensor 35 // fire sensor pin
#define buzzer 33 // buzzer pin

#define Fan 21// fanTrigger pin
#define ldrTrigger 13 // ldrTrigger pin
#define ldr 36 // ldr pin
#define Thres 2000 //ldr threshold

//////////////////////////////////

float temperature = 0.0;
float humidity = 0.0;
bool fan_on = false;
bool gateOpen = false;
unsigned long gateStartTime = 0;
int stableCount = 0;

bool newdata = true;
bool fire_on = false;

/////////////////////////////////

void updateValues();
void handleData();
void fire();
void gateControl();
void handlefire();


void setup() {
  Serial.begin(115200);

  gate.attach(gatePin); gate.write(0); // Attach servo to GPIO 27
  pinMode(getesensor, INPUT);
  pinMode(firesensor, INPUT_PULLUP);
  pinMode(Fan,OUTPUT);
  pinMode(ldrTrigger,OUTPUT);
  pinMode(ldr,INPUT);

  digitalWrite(ldrTrigger,HIGH);
  digitalWrite(Fan,HIGH);

  tft.init();
  tft.setRotation(0);
  tft.setSwapBytes(true);

  sprite.createSprite(120, 30);// Create sprite (small area for text)
  

  if (!WiFi.config(local_IP, gateway, subnet)) Serial.println("Static IP Failed");// 🔥 Apply static IP BEFORE connecting

  WiFi.begin(ssid, password);
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    tft.pushImage(0, 0, IMG_W, IMG_H, greenoffline);// Draw background UI once
    delay(500);
    Serial.print(".");
  }
  tft.pushImage(0, 0, IMG_W, IMG_H, greenonline);// Draw background UI once

  Serial.println("\nConnected!");
  Serial.print("IP Address: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/set?temp=10&humid=50&fan=on");

  server.on("/set", handleData);
  server.on("/fire", handlefire);
  server.begin();

}


boolean lastWiFiState = false; // Track last WiFi state for change detection

void loop() {
  bool currentWiFiState = (WiFi.status() == WL_CONNECTED);

  // If WiFi just disconnected
  if (!currentWiFiState && lastWiFiState == true) {
    tft.pushImage(0, 0, IMG_W, IMG_H, greenoffline);
    Serial.println("WiFi Lost");
  }

  // If WiFi just connected
  if (currentWiFiState && lastWiFiState == false) {
    tft.pushImage(0, 0, IMG_W, IMG_H, greenonline);
    Serial.println("WiFi Connected");
    updateValues(); // Update display immediately on reconnect
  }

  // Update last state
  lastWiFiState = currentWiFiState;
  server.handleClient();
  if(newdata){
    updateValues();
    newdata = false; // Reset flag after updating values
  }
  gateControl();
  fire();
  if(fire_on==true){ handlefire(); fire_on=false;}

  int ldrVal = analogRead(ldr);
  //Serial.println(ldrVal);
  if(ldrVal < Thres){
    digitalWrite(ldrTrigger,LOW);
  }else{
    digitalWrite(ldrTrigger,HIGH);
  }


  delay(50);
}

void drawValue(int x, int y, const char* text, uint16_t color) {

  int w = 120;
  int h = 30;

  // ✅ Step 1: Restore background properly (row by row)
  for (int row = 0; row < h; row++) {
    tft.pushImage(
      x,
      y + row,
      w,
      1,
      &greenonline[(y + row) * IMG_W + x]
    );
  }

  // ✅ Step 2: Draw text using transparent sprite
  sprite.fillSprite(TFT_BLACK);
  sprite.setTextColor(color, TFT_BLACK); // Set text color with black background for transparency
  sprite.setTextSize(3);
  sprite.setCursor(0, 5);

  sprite.print(text);

  sprite.pushSprite(x, y, TFT_BLACK);

}

void updateValues() {
  char buffer[20];

  // temperature
  sprintf(buffer, "%.1f", temperature);
  drawValue(130, 75, buffer, TFT_WHITE); //horrizontal,height

  // humidity
  sprintf(buffer, "%.1f%%", humidity);
  drawValue(125, 150, buffer, TFT_WHITE);

  // fan
  if(fan_on){
    sprintf(buffer, "ON");
    drawValue(130, 225, buffer, TFT_WHITE);
    digitalWrite(Fan,LOW);
  }
   else{
     sprintf(buffer, "OFF");
    drawValue(130, 225, buffer, TFT_WHITE);
    digitalWrite(Fan,HIGH);
   }

}

void handleData() {////////////////////////for field esp only////////////////////////////////////////////
  String response = "";

  // temperature
  if (server.hasArg("temp")) {
    temperature = server.arg("temp").toFloat();
    fan_on = (temperature > 25.0);
    Serial.print("Temperature: ");
    Serial.println(temperature);
    Serial.print("Fan: ");
    Serial.println(fan_on ? "ON" : "OFF");
    response += "Temperature OK | ";
  }
  //humidity
  if (server.hasArg("humid")) {
    humidity = server.arg("humid").toFloat();
    Serial.print("Humidity: ");
    Serial.println(humidity);
    response += "Humidity OK | ";
  }
  //fan
  if (server.hasArg("fan")) {
    response += "Fan Auto | ";
  }

  // FINAL RESPONSE (ONLY ONCE)
  if (response == "") {
    server.send(400, "text/plain", "No valid parameters");
  } else {
    newdata = true; // Flag to indicate new data received
    server.send(200, "text/plain", response);
  }
}

void fire(){
  // Serr));ial.println(analogRead(
  int val = digitalRead(firesensor);

  if (val == LOW) {
    stableCount++;
  } else {
    stableCount = 0;
  }

  if (stableCount >= 10) {
    Serial.println("Fire Detected!");
    digitalWrite(buzzer, HIGH); // Activate buzzer
    fire_on = true;
    delay(500); // Keep buzzer on for 1 second
    digitalWrite(buzzer, LOW); // Deactivate buzzer
  }
  else{
    fire_on=false;
  }
}

void gateControl(){
 if (digitalRead(getesensor) == LOW && !gateOpen) {
    Serial.println("Gate Opened!");

    gate.write(90);           // Open gate
    gateOpen = true;
    gateStartTime = millis(); // Start timer
  }

  // Check if 3 seconds passed
  if (gateOpen && millis() - gateStartTime >= 3000) {
    Serial.println("Gate Closed!");

    gate.write(0);  // Close gate
    gateOpen = false;
  }
}

void handlefire(){
  if(fire_on){
     server.send(200, "text/plain", "Fire Detected");
  }
  else{
    server.send(200, "text/plain", "No Fire Detected");
  }
}
