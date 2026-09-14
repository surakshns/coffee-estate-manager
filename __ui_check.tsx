import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Labour} from './src/components/Labour';
import {Dashboard} from './src/components/Dashboard';
import {supabase} from './src/lib/supabase';
import './src/styles.css';
const date='2026-09-09';
const original={workers:[{id:'one',name:'Asha Kumar',active:true,default_weekly_amount:2250,default_days_worked:5},{id:'two',name:'Bala Krishnamurthy',active:true,default_weekly_amount:1800,default_days_worked:4}],weeklyPayments:[{id:'p1',worker_id:'one',week_start:date,amount:2250,days_worked:5,daily_rate:450,loan_deduction:250},{id:'p2',worker_id:'two',week_start:date,amount:1800,days_worked:4,daily_rate:450,loan_deduction:0}],workerLoans:[{id:'a1',worker_id:'one',loan_date:'2026-09-01',amount:2000,kind:'advance',notes:''},{id:'r1',worker_id:'one',loan_date:date,amount:250,kind:'repayment',notes:'Repayment recorded with weekly payment'},{id:'r2',worker_id:'one',loan_date:date,amount:100,kind:'repayment',notes:'Cash clearance'}],jointLoans:[],jointLoanRepayments:[],labourRates:[],categories:[],expenses:[],prices:[],monthlyGuideEntries:[],production:[],sales:[]};
function Check(){const [data,setData]=useState(original);
(supabase as any).rpc=async(name:string,args:any)=>{if(name!=='save_weekly_labour')throw new Error('Unexpected write');
setData(current=>({...current,weeklyPayments:args.p_rows.map((r:any,index:number)=>({id:'p'+index,worker_id:r.worker_id,week_start:args.p_week_start,days_worked:r.days_worked,daily_rate:r.daily_rate,amount:r.excluded?0:r.days_worked*r.daily_rate,loan_deduction:r.personal_deduction+r.joint_deduction,excluded:r.excluded})),workerLoans:[...current.workerLoans.filter(r=>r.notes!=='Repayment recorded with weekly payment'),...args.p_rows.filter((r:any)=>r.personal_deduction>0).map((r:any)=>({id:'repay'+r.worker_id,worker_id:r.worker_id,loan_date:args.p_week_start,amount:r.personal_deduction,kind:'repayment',notes:'Repayment recorded with weekly payment'}))]})); return {error:null};};
(supabase as any).from=(table:string)=>({insert:async(payload:any)=>{if(table!=='workers')throw new Error('Unexpected insert');setData(current=>({...current,workers:[...current.workers,{id:'new-worker',...payload}]}));return {error:null};}});
return new URLSearchParams(location.search).has('dashboard')?<Dashboard data={data as any} year={2026}/>:<Labour data={data as any} year={2026} refresh={async()=>{}}/>;}
createRoot(document.getElementById('root')!).render(<Check/>);
