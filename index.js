const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// json web token(JWT) er jonno
const jwt = require('jsonwebtoken');

//.env file ke read korar jonno
require('dotenv').config()

// Stirpe key
const stripe = require("stripe")(process.env.STRIPE_SECRECT_KEY);


const port = process.env.PORT || 5000;
const app = express();

// Middle ware
app.use(cors());
app.use(express.json());

// ekhane verify JWT Token tar ekta middle ware bebohar korte hobe jeta ekta function
function verifyToken(req, res, next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(404).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            return res.status(403).send({message: 'forbidden access'})
        }
        req.decoded = decoded;
        next()
    })
}

// database connect

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.bugesq5.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri);
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
async function run() {
    try {
        const appointmentCollections = client.db('doctorsPortal').collection('appointmentOptions');
        const bookingsCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentCollection = client.db('doctorsPortal').collection('payments');
        // admin take verify korar jonno ekta middleware mane kono doctor ke
        // delete korar agee check korbe je se admin kina jehutu database theke check korbe
        // tai ei try er vitorei likhte hobe 

        const verifyAdmin = async(req, res, next)=>{
            const decodedEmail = req.decoded.email;
            const query = {email : decodedEmail};
            const user = await usersCollection.findOne(query);
            if(user?.role !== 'admin'){
                return res.status(403).send({message: 'Forbidden access'})
            }
            next();
        }
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentCollections.find(query).toArray();

            // get the booking of the provided date
            const bookingQuery = {appointDate:date};
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            // Code carefully
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookSlots = optionBooked.map(book => book.selectedSlot)

                //jeila slot time theke booked hoya geice seila bade slot time gulo paowar jonne
                const remainingSlot = option.slots.filter(slot => !bookSlots.includes(slot));
                option.slots = remainingSlot;
                
            })
            res.send(options)
        })

        /*
            Api naming Conventions
            * app.get('/bookings')
            * app.get('/bookings/:id)
            * app.post('/bookings');
            * app.patch('/bookings/:id)
            * app.delete('/bookings/:id)
        */

        //je nirdisto email diya add appointmet korece tar tottho gulo dashboard
        // e dekhabe orthat je email bortomane login kora tar appointment gulo dekhabe
        app.get('/bookings', verifyToken, async(req, res)=>{
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if(email !== decodedEmail){
                return res.status(403).send({message: 'Forbidden access'})
            }
            const query = {email : email};
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings)
        })

        // modal theke data pathabo sejonno POST korbo
        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            console.log(booking);

            // kono bebohar karike ekoi date e oi treatment takei add korte dibo na. ekbar add korle 
            // modal theke r add korte parbe na. tokhom toast akare kisu ekta dekhabe

            const query = {
                appointDate : booking.appointDate,
                email : booking.email, 
                treatment : booking.treatment
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if(alreadyBooked.length){
                const message = `you already have a booking on ${booking.appointDate}`;
                return res.send({acknowledged:false, message})
            }
            const result = await bookingsCollection.insertOne(booking);
            res.send(result)
        })

        // ekhane token(JWT) ta ke issu kore pete chai
        app.get('/jwt',async(req,res)=>{
            const email = req.query.email;
            console.log(email)
            const query = {email: email}
            const user = await usersCollection.findOne(query);
            if(user){
                const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn:'1h'});
                return res.send({accesstoken: token})
            }
            else{
                res.status(403).send({accesstoken: ''})
            }
            
        })


        // ebar je je user gulo hobe segulo database e save korbo sejonno kintu usersCollection toiri
        // korci
        app.post('/users', async(req, res)=>{
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        //ebar user guloke pete chai
        app.get('/users', async(req, res)=>{
            const query={};
            const users = await usersCollection.find(query).toArray();
            res.send(users)
        })

        // ebar nirdisto kono user ke update korbo ba admin role toiri korbo
        app.put('/users/admin/:id',verifyToken, verifyAdmin, async(req, res)=>{
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const options = {upsert: true}
            const updateDoc = {
                $set:{
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result)
        })

        // ebar get kore dekhbe je oi email ala ta admin kin na
        app.get('/users/admin/:email', async(req, res)=>{
            const email = req.params.email;
            const query = {email};
            const user = await usersCollection.findOne(query);
            res.send({isAdmin : user?.role === 'admin'})
        })

        // kono appointment er nirdisto data ke paowar jonno(sudhu nam gulo)
        app.get('/appointspecialty', async(req, res)=>{
            const query = {};
            const result = await appointmentCollections.find(query).project({name:1}).toArray()
            res.send(result);
        })

        // ebar doctors ke mongodb te insert korbo
        app.post('/doctors',verifyToken, verifyAdmin, async(req, res)=>{
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })

        // ebar doctor guloke pabar cesta kore managedoctor ui te dekhabo
        app.get('/doctors',verifyToken,verifyAdmin, async(req, res)=>{
            const query = {};
            const doctor = await doctorsCollection.find(query).toArray();
            res.send(doctor)
        })

        // ebar nirdisto doctor ke delete korbo
        app.delete('/doctors/:id',verifyToken,verifyAdmin, async(req, res)=>{
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result)
        })

        //************* add temporary price
        // app.get('/addprice', async(req, res)=>{
        //     const filter = {}
        //     const options = {upsert:true}
        //     const updatePrice = {
        //         $set:{
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentCollections.updateMany(filter, updatePrice, options);
        //     res.send(result)

        // })


        // payment button korarjonno
        app.get('/payment/:id', async(req, res)=>{
            const id = req.params.id;
            const query = {_id: ObjectId(id)};
            const result = await bookingsCollection.findOne(query);
            res.send(result);
        })

        // payment intent
        app.post('/create-payment-intent', async(req, res)=>{
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
            
            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount:amount,
                "payment_method_types": [
                    "card"
                  ],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
              });
        })

        // payments info gulo database e save kora
        app.post('/payments', async(req, res)=>{
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            const id = payment.bookingId;
            const filter = {_id: ObjectId(id)};
            const updatedDoc = {
                $set:{
                    paid:true,
                    transactionId:payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

    }
    finally {

    }
}
run().catch(console.log)


//testing server path
app.get('/', async (req, res) => {
    res.send('doctors server running')
})

app.listen(port, () => {
    console.log('doctor server running on port', port)
})
