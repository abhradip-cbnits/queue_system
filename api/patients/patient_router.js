const router = require("express").Router();
const pool = require("../../config/database");
const bodyParser = require('body-parser');
const util = require("../../utils/utils")
module.exports = router;

router.use(bodyParser.json());
router.post('/GetUserDetailsByNRICNumber', async (req, res) => {
    try {
        const body = req.body
        // Query to fetch data from PostgreSQL based on the input ID
        if (!body || !body.nric_number) {
            res.status(400).json({ error: 'Invalid request body or missing nric_number' });
        }
        const query = `SELECT 
                        p.id,
                        p.nric_number,
                        p."name",
                        p.address,
                        p.phone_no,
                        p.email,
                        p.age,
                        p.dob,
                        p.created_at,
                        p.updated_at,
                        (SELECT 
                            MAX(a.id) 
                        FROM 
                            public.appointment a 
                        WHERE 
                            a.patient_id = p.id
                            AND (a.consultation_priority != '0' OR a.medicine_priority != '0' OR a.labtest_priority != '0' OR a.payment_priority != '0')
                        ) AS serial_number
                    FROM 
                        public.patient p
                    WHERE 
                        p.nric_number = $1;
    `;
        const { rows } = await pool.query(query, [body.nric_number]);
        if (rows.length === 0) {
            // If no data is found for the given ID, return 404 Not Found
            res.status(404).json({ error: 'patient not found' });
        } else {
            res.json(rows);
        }
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/GetserialNumber', async (req, res) => {
    try {
        const body = req.body
        if (!body || !body.nric_number || !body.queue_array) {
            res.status(400).json({ error: 'Invalid request body or missing nric_number and queue_array' });
        }
        const query = 'SELECT p.id FROM public.patient p WHERE p.nric_number = $1';
        const { rows } = await pool.query(query, [body.nric_number]);
        if (rows.length === 0) {
            res.status(404).json({ error: 'patient not found' });
        }
        const id = rows[0].id
        var insertquery = `INSERT INTO public.appointment (nric_number, patient_id, appointment_date, `;
        var values = `'${body.nric_number}', '${id}', now(), `;
        for (var i = 0; i < body.queue_array.length; i++) {
            if (body.queue_array[i] == 'consultation') {
                var strId = (i + 1).toString();
                if (i == 0) {
                    insertquery += `appointment_consultation_status, consultation_priority, `;
                    values += `'pending', '${strId}', `;
                } else {
                    insertquery += `appointment_consultation_status, consultation_priority, `;
                    values += `'init', '${strId}', `;
                }
            }
            if (body.queue_array[i] == 'labtest') {
                var strId = (i + 1).toString();
                if (i == 0) {
                    insertquery += `appointment_labtest_status, labtest_priority, `;
                    values += `'pending', '${strId}', `;
                } else {
                    insertquery += `appointment_labtest_status, labtest_priority, `;
                    values += `'init', '${strId}', `;
                }
            }
            if (body.queue_array[i] == 'medicine') {
                var strId = (i + 1).toString();
                if (i == 0) {
                    insertquery += `appointment_medicine_status, medicine_priority, `;
                    values += `'pending', '${strId}', `;
                } else {
                    insertquery += `appointment_medicine_status, medicine_priority, `;
                    values += `'init', '${strId}', `;
                }
            }
            if (body.queue_array[i] == 'payment') {
                var strId = (i + 1).toString();
                if (i == 0) {
                    insertquery += `appointment_payment_status, payment_priority, `;
                    values += `'pending', '${strId}', `;
                } else {
                    insertquery += `appointment_payment_status, payment_priority, `;
                    values += `'init', '${strId}', `;
                }
            }
        }
        values += `now(), now(), now()`;
        insertquery += `booking_date, created_at, updated_at) VALUES (${values}) RETURNING id as serial_number;`;
        const { rows: resultrows } = await pool.query(insertquery);
        const serialNumber = resultrows[0].serial_number;

        var queueQuery = `INSERT INTO public.${body.queue_array[0]}_queue
        ( appointment_id, status, ${body.queue_array[0]}_date, created_at, updated_at)
        VALUES( ${serialNumber}, 'active'::character varying, now(), now(), now());`
        await pool.query(queueQuery)
        res.json({ serialNumber });
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


router.post('/ListQueueOnRole', async (req, res) => {
    try {
        const body = req.body
        if (!body || !body.role) {
            res.status(400).json({ error: 'Invalid request body or missing role' });
        }
        const query = `select a.nric_number, a.id as serial_number, q.id as ${req.body.role}_queue_number,q.status, a.booking_date ,p."name" ,p.address ,p.email ,p.age ,p.phone_no, a.appointment_consultation_status ,a.consultation_priority ,a.appointment_medicine_status ,a.medicine_priority ,a.appointment_labtest_status ,a.labtest_priority ,a.appointment_payment_status ,a.payment_priority  from ${req.body.role}_queue q inner join appointment a on q.appointment_id = a.id 
    inner join patient p on p.id = a.patient_id`
        const { rows } = await pool.query(query)
        res.json(rows)
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/NoShow', async (req, res) => {
    try {
        const body = req.body
        if (!body || !body.role || !body.queue_id || !body.serial_number) {
            res.status(400).json({ error: 'Invalid request body or missing role, queue_id or serial_number' });
        }
        var query = `update public.${body.role}_queue
    set status='inactive'::character varying, updated_at=now()
    where id = ${body.queue_id};`
        await pool.query(query)
        query = `UPDATE public.appointment
    SET appointment_consultation_status='NoShow', consultation_priority=0, appointment_medicine_status='NoShow', medicine_priority=0, appointment_labtest_status='NoShow', labtest_priority=0, appointment_payment_status='NoShow', payment_priority=0, updated_at=now()
    WHERE id= ${body.serial_number};`
        await pool.query(query)
        res.status(200).json({ message: "Noted the patient who didn't show up" })
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/ActionUpdate', async (req, res) => {
    try {
        const body = req.body
        if (!body || !body.role || !body.queue_id || !body.serial_number || !body.appointment_status) {
            res.status(400).json({ error: 'Invalid request body or missing role, queue_id or serial_number' });
        }
        var query = `update public.${body.role}_queue
        set status='inactive'::character varying, updated_at=now()
        where id = ${body.queue_id};`
        await pool.query(query)
        query = `UPDATE public.appointment
        SET appointment_${body.role}_status='${body.appointment_status}', ${body.role}_priority=0, updated_at=now()
        WHERE id= ${body.serial_number};`
        await pool.query(query)
        if (body && body.queue_array) {
            var updateQuery = ` update public.appointment
        set `
            for (var i = 0; i < body.queue_array.length; i++) {
                if (body.queue_array[i] == 'consultation' && body.role != 'consultation') {
                    var strId = (i + 1).toString();
                    if (i == 0) {
                        updateQuery += `appointment_consultation_status = 'pending' , consultation_priority = ${strId}, `;
                    } else {
                        updateQuery += `appointment_consultation_status = 'init', consultation_priority = '${strId}', `;
                    }
                }
                if (body.queue_array[i] == 'labtest' && body.role != 'labtest') {
                    var strId = (i + 1).toString();
                    if (i == 0) {
                        updateQuery += `appointment_labtest_status = 'pending', labtest_priority = '${strId}', `;
                    } else {
                        updateQuery += `appointment_labtest_status ='init', labtest_priority= '${strId}', `;
                    }
                }
                if (body.queue_array[i] == 'medicine' && body.role != 'medicine') {
                    var strId = (i + 1).toString();
                    if (i == 0) {
                        updateQuery += `appointment_medicine_status = 'pending', medicine_priority = '${strId}', `;
                    } else {
                        updateQuery += `appointment_medicine_status = 'init', medicine_priority = '${strId}', `;
                    }
                }
                if (body.queue_array[i] == 'payment' && body.role != 'payment') {
                    var strId = (i + 1).toString();
                    if (i == 0) {
                        updateQuery += `appointment_payment_status = 'pending', payment_priority = '${strId}', `;
                    } else {
                        updateQuery += `appointment_payment_status = 'init', payment_priority = '${strId}', `;
                    }
                }
            }
            updateQuery += ` updated_at = now() where id = ${body.serial_number}`
            await pool.query(updateQuery)
        }
        query = `select appointment_consultation_status, consultation_priority, appointment_medicine_status, medicine_priority,appointment_labtest_status,labtest_priority,appointment_payment_status,payment_priority from public.appointment where id ='${body.serial_number}'`
        const { rows: row } = await pool.query(query)
        var priorities = [row[0].consultation_priority, row[0].medicine_priority, row[0].labtest_priority, row[0].payment_priority], message, min;
        priorities = priorities.sort()
        for (let i = 0; i < priorities.length; i++) {
            if (priorities[i] !== 0) {
                min = priorities[i];
                break;
            }
        }
        if (min == row[0].consultation_priority) {
            message = 'consultation'
            query = `INSERT INTO public.consultation_queue
            ( appointment_id, status, consultation_date, created_at, updated_at)
            VALUES( ${body.serial_number}, 'active'::character varying, now(), now(), now());`
            await pool.query(query)
            query = `update public.appointment
            set consultation_priority = 1, appointment_consultation_status = 'pending'
            where id = ${body.serial_number}`
            await pool.query(query)
        }
        if (min == row[0].medicine_priority) {
            message = 'medicine'
            query = `INSERT INTO public.medicine_queue
            ( appointment_id, status, medicine_date, created_at, updated_at)
            VALUES( ${body.serial_number}, 'active'::character varying, now(), now(), now());`
            await pool.query(query)
            query = `update public.appointment
            set medicine_priority = 1, appointment_medicine_status = 'pending'
            where id = ${body.serial_number}`
            await pool.query(query)
        }
        if (min == row[0].labtest_priority) {
            message = 'lab-test'
            query = `INSERT INTO public.labtest_queue
            ( appointment_id, status, labtest_date, created_at, updated_at)
            VALUES( ${body.serial_number}, 'active'::character varying, now(), now(), now());`
            await pool.query(query)
            query = `update public.appointment
            set labtest_priority = 1, appointment_labtest_status = 'pending'
            where id = ${body.serial_number}`
            await pool.query(query)
        }
        if (min == row[0].payment_priority) {
            message = 'payment'
            query = `INSERT INTO public.payment_queue
            ( appointment_id, status, payment_date, created_at, updated_at)
            VALUES( ${body.serial_number}, 'active'::character varying, now(), now(), now());`
            await pool.query(query)
            query = `update public.appointment
            set payment_priority = 1, appointment_payment_status = 'pending'
            where id = ${body.serial_number}`
            await pool.query(query)
        }
        res.status(200).json({ message: "Action updated for the Patient, next priority: " + message })
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/PsuedoRegister', async (req, res) => {
    try {
        const body = req.body
        // Query to fetch data from PostgreSQL based on the input ID
        if (!body || !body.nric_number) {
            res.status(400).json({ error: 'Invalid request body or missing nric_number' });
        }
        const selectQuery = 'SELECT * FROM public.patient p WHERE p.nric_number = $1';
        const { rows } = await pool.query(selectQuery, [body.nric_number]);
        if (rows.length === 0) {
            const name = util.nameList[Math.floor(Math.random() * util.nameList.length)] + " " + util.nameList[Math.floor(Math.random() * util.nameList.length)]
            const address = Math.floor(Math.random() * 1000) + " " + util.nameList[Math.floor(Math.random() * util.nameList.length)] + " St, " + util.locationList[Math.floor(Math.random() * util.locationList.length)]
            const phoneNumber = Math.floor(Math.random() * 1000) + "-" + Math.floor(Math.random() * 1000) + "-" + Math.floor(Math.random() * 10000)
            const email = name.replaceAll(' ', '.').toLowerCase() + "@example.com"
            const age = Math.floor(Math.random() * 100)
            const d = new Date();
            const dob = Math.abs(age - d.getFullYear()) + "-" + Math.floor(Math.random() * 12) + "-" + Math.floor(Math.random() * 28)
            let query = `INSERT INTO public.patient (nric_number, "name", address, phone_no, email, age, dob) VALUES ('${body.nric_number}','${name}','${address}','${phoneNumber}','${email}','${age}','${dob}')`
            console.log(query)
            await pool.query(query)
            res.status(200).json({ isExist: "false", Message: "New patient created name: " + name + ",address: " + address + " ,phone number: " + phoneNumber + " email: " + email + " age: " + age + " dob :" + dob });
        } else {
            res.status(200).json({ isExist: "true", Message: "No new patient created" });
        }
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/MarkAllCompleted', async (req, res) => {
    try {
        const body = req.body
        if (!body.serial_number) {
            res.status(400).json({ error: 'Invalid request body or missing serial_number' });
        }
        let query = `update public.consultation_queue
                        set status='inactive'::character varying, updated_at=now()
                        where appointment_id = ${body.serial_number};`
        await pool.query(query)
        query = `update public.medicine_queue
                        set status='inactive'::character varying, updated_at=now()
                        where appointment_id = ${body.serial_number};`
        await pool.query(query)
        query = `update public.labtest_queue
                        set status='inactive'::character varying, updated_at=now()
                        where appointment_id = ${body.serial_number};`
        await pool.query(query)
        query = `update public.payment_queue
                        set status='inactive'::character varying, updated_at=now()
                        where appointment_id = ${body.serial_number};`
        await pool.query(query)
        query = `UPDATE public.appointment
                    SET appointment_consultation_status='completed', consultation_priority=0, appointment_medicine_status='completed', medicine_priority=0, appointment_labtest_status='completed', labtest_priority=0, appointment_payment_status='completed', payment_priority=0, updated_at=now()
                    WHERE id= ${body.serial_number};`
        await pool.query(query)
        res.status(200).json({ message: "marked all completed for this patient" })
    } catch (err) {
        console.error('Error fetching data', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});