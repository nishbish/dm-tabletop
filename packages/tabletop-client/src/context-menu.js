class ContextMenu {
    constructor(data) {
        this.theme = data.theme
        this.parent = data.parent || document.body;
        this.build(data.items);
    }

    build(options) {
        this.menu = document.createElement('menu');
        this.menu.classList.add(`context-menu-${this.theme}`);
		this.menu.classList.add('context-menu-element');
        options.forEach(option => this.buildOption(option));
        this.parent.appendChild(this.menu);
    }

    buildOption(option) {
        const li = document.createElement('LI');
        li.classList.add(`context-menu-${this.theme}-item`);
		li.classList.add('context-menu-element');
		
        li.addEventListener('click', option.action);

        const button = document.createElement('button');
        button.classList.add(`context-menu-${this.theme}-btn`);
		button.classList.add('context-menu-element');

        //icon
        if ('icon' in option)
        {
            const i = document.createElement('span');
            i.classList.add(`context-menu-${this.theme}-icon`);
            i.classList.add('context-menu-element');
			i.classList.add('material-icons');
            i.innerHTML = `${option.icon}`;
            i.style.fontSize = '22px';
            i.style.lineHeight = '18px';
            i.style.float = 'left';
            button.appendChild(i);
        }

        //thumbnail
        if ('thumb' in option)
        {
            const t = document.createElement('img');
			t.classList.add('context-menu-element');
            t.src = `${option.thumb}`;
            t.alt = `${option.name}`;
            t.classList.add('context-menu-thumb');
            t.style.height = '50px';
            t.style.maxWidth = '50px';

            button.appendChild(t);
        }

        const span = document.createElement('span');
		span.classList.add('context-menu-element');
        span.classList.add(`context-menu-${this.theme}-text`);
        span.textContent = option.name;

        if ('data' in option)
        {
            span.setAttribute('data', option.data);
        }
        
        button.appendChild(span);
        li.appendChild(button);
        this.menu.appendChild(li);
    }

    show(x, y) {
        // x / y are viewport coordinates (the menu is position: fixed).
        const w = window.innerWidth;
        const h = window.innerHeight;

        const mw = this.menu.offsetWidth;
        const mh = this.menu.offsetHeight;

        if (x + mw > w) { x = x - mw; }
        if (y + mh > h) { y = y - mh; }

        this.menu.style.left = x + 'px';
        this.menu.style.top = y + 'px';
        this.menu.classList.add(`show-context-menu-${this.theme}`);
    }

    hide() {
        this.menu.classList.remove(`show-context-menu-${this.theme}`);
    }

    isOpen() {
        return this.menu.classList.contains(`show-context-menu-${this.theme}`);
    }
}

export { ContextMenu };