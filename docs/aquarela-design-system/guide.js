const $ = (id) => document.getElementById(id);
let toastTimer;
function notify(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
document.querySelectorAll('[data-toast]').forEach(button => button.addEventListener('click', () => notify(button.dataset.toast)));
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(button.dataset.copy); notify('Copied ' + button.dataset.copy); } catch { notify('Color value: ' + button.dataset.copy); } }));
document.querySelectorAll('[role="switch"]').forEach(button => button.addEventListener('click', () => button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'))));
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) { tabs.forEach(item => { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1; $(item.getAttribute('aria-controls')).hidden = !selected; }); }
tabs.forEach((tab, index) => { tab.addEventListener('click', () => selectTab(tab)); tab.addEventListener('keydown', event => { const targets = { ArrowRight: (index+1)%tabs.length, ArrowLeft: (index+tabs.length-1)%tabs.length, Home:0, End:tabs.length-1 }; if (event.key in targets) { event.preventDefault(); const target=tabs[targets[event.key]]; selectTab(target); target.focus(); } }); });
const inventory = [
  { name:'House blend', category:'Coffee beans', quantity:12.5, minimum:5, unit:'kg' },
  { name:'Oat milk', category:'Milk & alternatives', quantity:4, minimum:8, unit:'L' },
  { name:'Whole milk', category:'Milk & alternatives', quantity:18, minimum:10, unit:'L' },
  { name:'Butter croissant', category:'Bakery', quantity:24, minimum:12, unit:'units' },
  { name:'Takeaway lids', category:'Packaging', quantity:0, minimum:100, unit:'units' }
];
function stockStatus(item) { return item.quantity === 0 ? ['Out of stock','danger','×'] : item.quantity < item.minimum ? ['Low stock','warning','!'] : ['In stock','success','✓']; }
function renderInventory() {
  const search = $('search').value.trim().toLowerCase(); const filter = $('status-filter').value;
  const visible = inventory.filter(item => item.name.toLowerCase().includes(search) && (filter === 'all' || stockStatus(item)[0] === filter));
  $('inventory-body').replaceChildren();
  visible.forEach(item => { const tr = document.createElement('tr'); const status = stockStatus(item); [item.name,item.category,`${item.quantity.toLocaleString('en-GB')} ${item.unit}`,`${item.minimum.toLocaleString('en-GB')} ${item.unit}`].forEach((value,index) => { const td = document.createElement('td'); td.textContent = value; if(index>=2)td.className='numeric'; tr.append(td); }); const td=document.createElement('td'); const badge=document.createElement('span'); badge.className=`aq-badge aq-badge--${status[1]}`; badge.textContent=`${status[2]} ${status[0]}`; td.append(badge); tr.append(td); $('inventory-body').append(tr); });
  $('no-results').hidden = visible.length>0; $('result-count').textContent=`${visible.length} of ${inventory.length} products · Illustrative inventory`;
}
$('search').addEventListener('input',renderInventory); $('status-filter').addEventListener('change',renderInventory);
$('clear-filters').addEventListener('click',()=>{ $('search').value=''; $('status-filter').value='all'; renderInventory(); $('search').focus(); });
$('density').addEventListener('click',()=>{const compact=$('density').getAttribute('aria-pressed')!=='true'; $('density').setAttribute('aria-pressed',String(compact)); $('inventory').dataset.density=compact?'compact':'comfortable';});
$('add-product').addEventListener('click',()=>{$('product-form').reset(); $('product-dialog').showModal(); $('new-name').focus();});
['close-dialog','cancel-dialog'].forEach(id=>$(id).addEventListener('click',()=>$('product-dialog').close()));
$('product-form').addEventListener('submit',event=>{event.preventDefault(); const name=$('new-name').value.trim(); if(!name){$('new-name').setCustomValidity('Enter a product name.'); $('new-name').reportValidity(); return;} inventory.push({name,category:$('new-category').value,quantity:Number($('new-quantity').value),minimum:Number($('new-minimum').value),unit:$('new-unit').value}); $('search').value=''; $('status-filter').value='all'; renderInventory(); $('product-dialog').close(); notify(`${name} added to this preview.`);});
$('new-name').addEventListener('input',()=>$('new-name').setCustomValidity(''));
const sectionObserver = new IntersectionObserver(entries=>{ entries.forEach(entry=>{ if(entry.isIntersecting){ document.querySelectorAll('.guide-side nav a').forEach(a=>{if(a.hash==='#'+entry.target.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});} }); },{rootMargin:'-10% 0px -65% 0px',threshold:0});
document.querySelectorAll('main section').forEach(section=>sectionObserver.observe(section));
renderInventory();
