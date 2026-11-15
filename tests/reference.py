"""Independent erfc pricing and discounted-gain hedge reference. Standard library only."""
import math,subprocess,os
N=lambda x:.5*math.erfc(-x/math.sqrt(2))
def quote(s,t,sig,kind):
 if t==0:return max(s-100 if kind=='call' else 100-s,0),0
 v=sig*math.sqrt(t);d=(math.log(s/100)+(.02+.5*sig*sig)*t)/v
 return (s*N(d)-100*math.exp(-.02*t)*N(d-v),N(d)) if kind=='call' else (100*math.exp(-.02*t)*N(v-d)-s*N(-d),N(d)-1)
def path(sig,seed,stream):
 state=(seed+104729*stream)&0xffffffff;s=[100.]
 for i in range(252):
  state=(1664525*state+1013904223)&0xffffffff;u=(state+.5)/2**32
  state=(1664525*state+1013904223)&0xffffffff;v=(state+.5)/2**32
  s.append(s[-1]*math.exp((.02-.5*sig*sig)/252+sig/math.sqrt(252)*math.sqrt(-2*math.log(u))*math.cos(2*math.pi*v)))
 return s
def evaluate(s,hs,bps,n,kind):
 # Present value of gains minus present value of costs, not a mutable cash account.
 premium=quote(100,1,hs,kind)[0];gain=0;cost=0;old=0;out=[];fees=0
 for k in range(n+1):
  idx=k*(252//n);t=idx/252;spot=s[idx]
  if k:
   prev=(k-1)/n;gain+=old*(spot*math.exp(-.02*t)-s[idx-252//n]*math.exp(-.02*prev))
  mark,d=quote(spot,1-t,hs,kind);trade=d-old;fee=abs(trade)*spot*bps/10000;cost+=fee*math.exp(-.02*t);fees+=fee
  equity=(premium+gain-cost)*math.exp(.02*t);cash=equity-d*spot
  out.append([idx,t,spot,(cash+trade*spot+fee),old,d,trade,fee,cash,mark,equity,equity-mark]);old=d
 payoff=quote(s[-1],0,hs,kind)[0]
 return [premium,(premium+gain)*math.exp(.02)-payoff,(premium+gain-cost)*math.exp(.02)-payoff,fees,cost*math.exp(.02)],out
count=0;worst=0
def eq(a,b):
 global count,worst
 d=abs(a-b)/max(1,abs(a),abs(b));worst=max(d,worst);count+=1
 assert d<3e-10,(a,b,d)
for j in range(18):
 ps=[.1,.2,.5][j%3];hs=[.1,.3,.5][j//3%3];bps=[0,5,25][j%3];n=[1,4,12,28,84,252][j%6];seed=[1,2375,999999][j%3];kind='put' if j%2 else 'call'
 output=subprocess.check_output([os.environ.get('JAVA','java'),'-cp','build/classes','Dump',str(ps),str(hs),str(bps),str(n),str(seed),kind],text=True)
 s=path(ps,seed,0);summary,rows=evaluate(s,hs,bps,n,kind);stats={};errors={}
 for m in [1,4,12,28,84,252]:
  rr=[evaluate(path(ps,seed,k),hs,bps,m,kind)[0] for k in range(1,129)];es=[r[2]for r in rr];mean=sum(es)/128
  stats[m]=[m,mean,math.sqrt(sum((v-mean)**2 for v in es)/128),math.sqrt(sum(v*v for v in es)/128),math.sqrt(sum(r[1]**2 for r in rr)/128),sum(r[3] for r in rr)/128];errors[m]=es
 for line in output.splitlines():
  tag,*a=line.split(',');a=list(map(float,a))
  if tag=='P':eq(a[1],s[int(a[0])])
  elif tag=='R':
   for x,y in zip(a,summary):eq(x,y)
  elif tag=='L':
   for x,y in zip(a,rows[int(a[0])//(252//n)]):eq(x,y)
  elif tag=='S':
   for x,y in zip(a,stats[int(a[0])]):eq(x,y)
  elif tag=='E':eq(a[2],errors[int(a[0])][int(a[1])])
print(f'{count} independent Python checks passed, max scaled {worst}')
