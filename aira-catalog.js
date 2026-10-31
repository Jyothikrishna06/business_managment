// User-supplied sample Aira product and subscription catalog (USD).
export const levels=['Essential','Advanced','Premium'];
export const airaModels=[
 {key:'lite',name:'Aira Band Lite',description:'Affordable everyday activity tracking.',colors:['Black','Blue','Grey'],specifications:['0.96-inch OLED display','Steps, calories and distance tracking','Continuous heart-rate monitoring','Sleep-duration tracking','Automatic walking and running detection','IP67 water resistance','Bluetooth 5.0','Up to 7 days battery life','Android and iOS support'],plans:[
  {name:'Lite Basic',price:2.99,features:['Daily activity dashboard','Heart rate, steps and calories','7-day history']},
  {name:'Lite Plus',price:5.99,features:['Everything in Basic','Sleep analysis','Weekly reports','90-day history']},
  {name:'Lite Family',price:8.99,features:['Everything in Plus','Up to 3 users','Family dashboard','Health alerts']}]},
 {key:'active',name:'Aira Band Active',description:'Fitness, running and regular workouts.',specifications:['1.1-inch AMOLED display','Steps, calories, distance and active minutes','Continuous heart-rate monitoring','Blood-oxygen monitoring','20 workout modes','Automatic exercise detection','Connected GPS using customer phone','5 ATM water resistance','Up to 10 days battery life','Workout intensity and recovery score'],plans:[
  {name:'Active Start',price:4.99,features:['Activity tracking','Workout records','30-day history']},
  {name:'Active Coach',price:8.99,features:['Training goals','Advanced workout reports','Recovery score','One-year history']},
  {name:'Active Pro',price:13.99,features:['Personal training recommendations','Unlimited history','Performance comparisons']}]},
 {key:'balance',name:'Aira Band Balance',description:'Sleep, stress management and everyday wellness.',specifications:['1.2-inch AMOLED touch display','Heart-rate and blood-oxygen monitoring','Stress-level monitoring','Guided breathing exercises','Awake, light, deep and REM sleep stages','Skin-temperature trends','Menstrual-cycle tracking','Smart wake-up alarm','IP68 water resistance','Up to 8 days battery life'],plans:[
  {name:'Balance Daily',price:5.99,features:['Sleep duration','Daily stress score','Breathing exercises','30-day history']},
  {name:'Balance Insight',price:10.99,features:['Sleep-stage analysis','Temperature trends','Wellness reports','One-year history']},
  {name:'Balance Care',price:16.99,features:['Advanced wellness insights','Personalized goals','Caregiver sharing','Priority support']}]},
 {key:'pulse',name:'Aira Band Pulse',description:'Detailed wellness and recovery monitoring.',wellnessNotice:'ECG and health-alert features are presented as wellness features; medical approvals have not been established.',specifications:['1.3-inch high-resolution AMOLED display','Continuous and resting heart-rate monitoring','Blood-oxygen monitoring','Single-lead ECG recording','Irregular heart-rhythm notifications','Respiratory-rate monitoring','Skin-temperature trends','Sleep and recovery scores','Fall-detection alerts','Up to 6 days battery life','5 ATM water resistance'],plans:[
  {name:'Pulse Monitor',price:8.99,features:['Heart rate','Blood oxygen','ECG history','90-day storage']},
  {name:'Pulse Advanced',price:14.99,features:['Rhythm alerts','Respiratory trends','Sleep insights','Unlimited history']},
  {name:'Pulse Care+',price:24.99,features:['Family sharing','Emergency contacts','Downloadable reports','Priority assistance']}]},
 {key:'endurance',name:'Aira Band Endurance',description:'Rugged premium band for athletes and outdoor activities.',specifications:['1.4-inch always-on AMOLED display','Built-in dual-band GPS','Steps, distance, pace, elevation and calories','Heart rate and blood-oxygen monitoring','Training load and recovery analysis','Over 50 sport modes','Route tracking and navigation','Altimeter, compass and weather information','10 ATM water resistance','Shock-resistant metal body','Up to 18 days battery life','Up to 30 hours continuous GPS'],plans:[
  {name:'Endurance Explore',price:7.99,features:['GPS activity records','Routes','Basic workout analysis','90-day history']},
  {name:'Endurance Athlete',price:14.99,features:['Training load','Recovery','Performance trends','Route planning','Unlimited history']},
  {name:'Endurance Elite',price:22.99,features:['Advanced coaching','Race preparation','Team challenges','Data export','Priority support']}]}];
