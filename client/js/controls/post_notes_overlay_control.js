'use strict';

const keyboard = require('../util/keyboard.js');
const views = require('../util/views.js');
const events = require('../events.js');
const misc = require('../util/misc.js');
const Note = require('../models/note.js');
const Point = require('../models/point.js');

const svgNS = 'http://www.w3.org/2000/svg';
const snapThreshold = 10;
const circleSize = 10;

const MOUSE_BUTTON_LEFT = 1;

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_DOWN = 40;
const KEY_ESCAPE = 27;
const KEY_RETURN = 13;

function _getDistance(point1, point2) {
    return Math.sqrt(
        Math.pow(point1.x - point2.x, 2) +
        Math.pow(point1.y - point2.y, 2));
}

function _setNodeState(node, stateName) {
    if (node === null) {
        return;
    }
    node.setAttribute('data-state', stateName);
}

function _clearEditedNote(hostNode) {
    const node = hostNode.querySelector('[data-state=\'editing\']');
    _setNodeState(node, null);
    return node !== null;
}

class State {
    constructor(control) {
        this._control = control;
        const stateName = misc.decamelize(
            this.constructor.name.replace(/State/, ''));
        _setNodeState(control._hostNode, stateName);
        _setNodeState(control._textNode, stateName);
    }

    get canShowNoteText() {
        return false;
    }

    evtCanvasKeyDown(e) {
    }

    evtNoteMouseDown(e, hoveredNote) {
    }

    evtCanvasMouseDown(e) {
    }

    evtCanvasMouseMove(e) {
    }

    evtCanvasMouseUp(e) {
    }

    _getScreenPoint(point) {
        return new Point(
            point.x * this._control.boundingBox.width,
            point.y * this._control.boundingBox.height);
    }

    _snapPoints(targetPoint, referencePoint) {
        const targetScreenPoint = this._getScreenPoint(targetPoint);
        const referenceScreenPoint = this._getScreenPoint(referencePoint);
        if (_getDistance(targetScreenPoint, referenceScreenPoint) <
                snapThreshold) {
            targetPoint.x = referencePoint.x;
            targetPoint.y = referencePoint.y;
        }
    }

    _createNote() {
        const note = new Note();
        this._control._createPolygonNode(note);
        return note;
    }

    _getPointFromEvent(e) {
        return new Point(
            (e.clientX - this._control.boundingBox.left) /
                this._control.boundingBox.width,
            (e.clientY - this._control.boundingBox.top) /
                this._control.boundingBox.height);
    }
}

class ReadOnlyState extends State {
    constructor(control) {
        super(control);
        if (_clearEditedNote(control._hostNode)) {
            this._control.dispatchEvent(new CustomEvent('blur'));
        }
        keyboard.unpause();
    }

    get canShowNoteText() {
        return true;
    }
}

class PassiveState extends State {
    constructor(control) {
        super(control);
        if (_clearEditedNote(control._hostNode)) {
            this._control.dispatchEvent(new CustomEvent('blur'));
        }
        keyboard.unpause();
    }

    get canShowNoteText() {
        return true;
    }

    evtNoteMouseDown(e, hoveredNote) {
        this._control._state = new SelectedState(this._control, hoveredNote);
    }
}

class ActiveState extends State {
    constructor(control, note) {
        super(control);
        if (_clearEditedNote(control._hostNode)) {
            this._control.dispatchEvent(new CustomEvent('blur'));
        }
        keyboard.pause();
        if (note !== undefined) {
            this._note = note;
            this._control.dispatchEvent(
                new CustomEvent('focus', {
                    detail: {note: note},
                }));
            _setNodeState(this._note.groupNode, 'editing');
        }
    }
}

class SelectedState extends ActiveState {
    constructor(control, note) {
        super(control, note);
        this._clickTimeout = null;
        this._control._hideNoteText();
    }

    evtCanvasKeyDown(e) {
        const delta = e.ctrlKey ? 10 : 1;
        const offsetMap = {
            [KEY_LEFT]:  [-delta, 0],
            [KEY_UP]:    [0, -delta],
            [KEY_DOWN]:  [0, delta],
            [KEY_RIGHT]: [delta, 0],
        };
        if (offsetMap.hasOwnProperty(e.which)) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            if (e.shiftKey) {
                this._scaleEditedNote(...offsetMap[e.which]);
            } else {
                this._moveEditedNote(...offsetMap[e.which]);
            }
        }
    }

    evtNoteMouseDown(e, hoveredNote) {
        if (this._note !== hoveredNote) {
            this._control._state =
                new SelectedState(this._control, hoveredNote);
            return;
        }
        const mousePoint = this._getPointFromEvent(e);
        const mouseScreenPoint = this._getScreenPoint(mousePoint);
        this._clickTimeout = window.setTimeout(() => {
            for (let polygonPoint of this._note.polygon) {
                const distance = _getDistance(
                    mouseScreenPoint,
                    this._getScreenPoint(polygonPoint));
                if (distance < circleSize) {
                    this._control._state = new MovingPointState(
                        this._control, this._note, polygonPoint, mousePoint);
                    return;
                }
            }
            this._control._state = new MovingNoteState(
                this._control, this._note, mousePoint);
        }, 100);
    }

    evtCanvasMouseMove(e) {
        const mousePoint = this._getPointFromEvent(e);
        const mouseScreenPoint = this._getScreenPoint(mousePoint);
        for (let polygonPoint of this._note.polygon) {
            const distance = _getDistance(
                mouseScreenPoint,
                this._getScreenPoint(polygonPoint));
            polygonPoint.edgeNode.classList.toggle(
                'nearby', distance < circleSize);
        }
    }

    evtCanvasMouseDown(e) {
        const mousePoint = this._getPointFromEvent(e);
        const mouseScreenPoint = this._getScreenPoint(mousePoint);
        for (let polygonPoint of this._note.polygon) {
            const distance = _getDistance(
                mouseScreenPoint,
                this._getScreenPoint(polygonPoint));
            if (distance < circleSize) {
                this._control._state = new MovingPointState(
                    this._control, this._note, polygonPoint, mousePoint);
                return;
            }
        }
        this._control._state = new PassiveState(this._control);
    }

    evtCanvasMouseUp(e) {
        window.clearTimeout(this._clickTimeout);
    }

    _moveEditedNote(x, y) {
        for (let point of this._note.polygon) {
            point.x += x / this._control.boundingBox.width;
            point.y += y / this._control.boundingBox.height;
        }
    }

    _scaleEditedNote(x, y) {
        const min = new Point(Infinity, Infinity);
        const max = new Point(-Infinity, -Infinity);
        for (let point of this._note.polygon) {
            min.x = Math.min(min.x, point.x);
            min.y = Math.min(min.y, point.y);
            max.x = Math.max(max.x, point.x);
            max.y = Math.max(max.y, point.y);
        }
        const originalWidth = max.x - min.x;
        const originalHeight = max.y - min.y;
        const targetWidth = originalWidth +
            x / this._control.boundingBox.width;
        const targetHeight = originalHeight +
            y / this._control.boundingBox.height;
        const scaleX = targetWidth / originalWidth;
        const scaleY = targetHeight / originalHeight;
        for (let point of this._note.polygon) {
            point.x = min.x + ((point.x - min.x) * scaleX);
            point.y = min.y + ((point.y - min.y) * scaleY);
        }
    }
}

class MovingPointState extends ActiveState {
    constructor(control, note, notePoint, mousePoint) {
        super(control, note);
        this._notePoint = notePoint;
        this._originalNotePoint = {x: notePoint.x, y: notePoint.y};
        this._originalPosition = mousePoint;
        _setNodeState(this._note.groupNode, 'editing');
    }

    evtCanvasKeyDown(e) {
        if (e.which == KEY_ESCAPE) {
            this._notePoint.x = this._originalNotePoint.x;
            this._notePoint.y = this._originalNotePoint.y;
            this._control._state = new SelectedState(this._control, this._note);
        }
    }

    evtCanvasMouseMove(e) {
        const mousePoint = this._getPointFromEvent(e);
        this._notePoint.x += mousePoint.x - this._originalPosition.x;
        this._notePoint.y += mousePoint.y - this._originalPosition.y;
        this._originalPosition = mousePoint;
    }

    evtCanvasMouseUp(e) {
        this._control._state = new SelectedState(this._control, this._note);
    }
}

class MovingNoteState extends ActiveState {
    constructor(control, note, mousePoint) {
        super(control, note);
        this._originalPolygon = [...note.polygon].map(
            point => ({x: point.x, y: point.y}));
        this._originalPosition = mousePoint;
    }

    evtCanvasKeyDown(e) {
        if (e.which == KEY_ESCAPE) {
            for (let i of misc.range(this._note.polygon.length)) {
                this._note.polygon.at(i).x = this._originalPolygon[i].x;
                this._note.polygon.at(i).y = this._originalPolygon[i].y;
            }
            this._control._state = new SelectedState(this._control, this._note);
        }
    }

    evtCanvasMouseMove(e) {
        const mousePoint = this._getPointFromEvent(e);
        for (let point of this._note.polygon) {
            point.x += mousePoint.x - this._originalPosition.x;
            point.y += mousePoint.y - this._originalPosition.y;
        }
        this._originalPosition = mousePoint;
    }

    evtCanvasMouseUp(e) {
        this._control._state = new SelectedState(this._control, this._note);
    }
}

class ReadyToDrawState extends ActiveState {
    constructor(control) {
        super(control);
    }

    evtNoteMouseDown(e, hoveredNote) {
        this._control._state = new SelectedState(this._control, hoveredNote);
    }

    evtCanvasMouseDown(e) {
        const mousePoint = this._getPointFromEvent(e);
        if (e.shiftKey) {
            this._control._state = new DrawingRectangleState(
                this._control, mousePoint);
        } else {
            this._control._state = new DrawingPolygonState(
                this._control, mousePoint);
        }
    }
}

class DrawingRectangleState extends ActiveState {
    constructor(control, mousePoint) {
        super(control);
        this._note = this._createNote();
        this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        _setNodeState(this._note.groupNode, 'drawing');
    }

    evtCanvasMouseUp(e) {
        const mousePoint = this._getPointFromEvent(e);
        const x1 = this._note.polygon.at(0).x;
        const y1 = this._note.polygon.at(0).y;
        const x2 = this._note.polygon.at(2).x;
        const y2 = this._note.polygon.at(2).y;
        const width = (x2 - x1) * this._control.boundingBox.width;
        const height = (y2 - y1) * this._control.boundingBox.height;
        if (width < 20 && height < 20) {
            this._control._deletePolygonNode(this._note);
            this._control._state = new ReadyToDrawState(this._control);
        } else {
            this._control._post.notes.add(this._note);
            this._control._state = new SelectedState(this._control, this._note);
        }
    }

    evtCanvasMouseMove(e) {
        const mousePoint = this._getPointFromEvent(e);
        this._note.polygon.at(1).x = mousePoint.x;
        this._note.polygon.at(3).y = mousePoint.y;
        this._note.polygon.at(2).x = mousePoint.x;
        this._note.polygon.at(2).y = mousePoint.y;
    }
}

class DrawingPolygonState extends ActiveState {
    constructor(control, mousePoint) {
        super(control);
        this._note = this._createNote();
        this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        _setNodeState(this._note.groupNode, 'drawing');
    }

    evtCanvasKeyDown(e) {
        if (e.which == KEY_ESCAPE) {
            this._note.polygon.remove(this._note.polygon.secondLastPoint);
            if (this._note.polygon.length === 1) {
                this._cancel();
            }
        } else if (e.which == KEY_RETURN) {
            this._finish();
        }
    }

    evtNoteMouseDown(e, hoveredNote) {
        this.evtCanvasMouseDown(e);
    }

    evtCanvasMouseDown(e) {
        const mousePoint = this._getPointFromEvent(e);
        const firstPoint = this._note.polygon.firstPoint;
        const mouseScreenPoint = this._getScreenPoint(mousePoint);
        const firstScreenPoint = this._getScreenPoint(firstPoint);
        if (_getDistance(mouseScreenPoint, firstScreenPoint) < snapThreshold) {
            this._finish();
        } else {
            this._note.polygon.add(new Point(mousePoint.x, mousePoint.y));
        }
    }

    evtCanvasMouseMove(e) {
        const mousePoint = this._getPointFromEvent(e);
        const lastPoint = this._note.polygon.lastPoint;
        const secondLastPoint = this._note.polygon.secondLastPoint;
        const firstPoint = this._note.polygon.firstPoint;
        if (!lastPoint) {
            return;
        }

        if (e.shiftKey && secondLastPoint) {
            const direction = (Math.round(
                Math.atan2(
                    secondLastPoint.y - mousePoint.y,
                    secondLastPoint.x - mousePoint.x) /
                (2 * Math.PI / 4)) + 4) % 4;
            if (direction === 0 || direction === 2) {
                lastPoint.x = mousePoint.x;
                lastPoint.y = secondLastPoint.y;
            } else if (direction === 1 || direction === 3) {
                lastPoint.x = secondLastPoint.x;
                lastPoint.y = mousePoint.y;
            }
        } else {
            lastPoint.x = mousePoint.x;
            lastPoint.y = mousePoint.y;
        }
        this._snapPoints(lastPoint, firstPoint);
    }

    _cancel() {
        this._control._deletePolygonNode(this._note);
        this._control._state = new ReadyToDrawState(this._control);
    }

    _finish() {
        this._note.polygon.remove(this._note.polygon.lastPoint);
        if (this._note.polygon.length <= 2) {
            this._cancel();
        } else {
            this._control._post.notes.add(this._note);
            this._control._state = new SelectedState(this._control, this._note);
        }
    }
}

class PostNotesOverlayControl extends events.EventTarget {
    constructor(hostNode, post) {
        super();
        this._post = post;
        this._hostNode = hostNode;

        this._svgNode = document.createElementNS(svgNS, 'svg');
        this._svgNode.classList.add('notes-overlay');
        this._svgNode.setAttribute('preserveAspectRatio', 'none');
        this._svgNode.setAttribute('viewBox', '0 0 1 1');
        for (let note of this._post.notes) {
            this._createPolygonNode(note);
        }
        this._hostNode.appendChild(this._svgNode);
        this._post.notes.addEventListener('remove', e => {
            this._deletePolygonNode(e.detail.note);
        });

        const keyHandler = e => this._evtCanvasKeyDown(e);
        document.addEventListener('keydown', keyHandler);
        this._svgNode.addEventListener(
            'mousedown', e => this._evtCanvasMouseDown(e));
        this._svgNode.addEventListener(
            'mouseup', e => this._evtCanvasMouseUp(e));
        this._svgNode.addEventListener(
            'mousemove', e => this._evtCanvasMouseMove(e));

        const wrapperNode = document.createElement('div');
        wrapperNode.classList.add('wrapper');
        this._textNode = document.createElement('div');
        this._textNode.classList.add('note-text');
        this._textNode.appendChild(wrapperNode);
        this._textNode.addEventListener(
            'mouseleave', e => this._evtNoteMouseLeave(e));
        document.body.appendChild(this._textNode);

        views.monitorNodeRemoval(
            this._hostNode, () => {
                this._hostNode.removeChild(this._svgNode);
                document.removeEventListener('keydown', keyHandler);
                document.body.removeChild(this._textNode);
                this._state = new ReadOnlyState(this);
            });

        this._state = new ReadOnlyState(this);
    }

    switchToPassiveEdit() {
        this._state = new PassiveState(this);
    }

    switchToDrawing() {
        this._state = new ReadyToDrawState(this);
    }

    get boundingBox() {
        return this._hostNode.getBoundingClientRect();
    }

    _evtCanvasKeyDown(e) {
        this._state.evtCanvasKeyDown(e);
    }

    _evtCanvasMouseDown(e) {
        e.preventDefault();
        if (e.which !== MOUSE_BUTTON_LEFT) {
            return;
        }
        const hoveredNode = document.elementFromPoint(e.clientX, e.clientY);
        let hoveredNote = null;
        for (let note of this._post.notes) {
            if (note.polygonNode === hoveredNode) {
                hoveredNote = note;
            }
        }
        if (hoveredNote) {
            this._state.evtNoteMouseDown(e, hoveredNote);
        } else {
            this._state.evtCanvasMouseDown(e);
        }
    }

    _evtCanvasMouseUp(e) {
        this._state.evtCanvasMouseUp(e);
    }

    _evtCanvasMouseMove(e) {
        this._state.evtCanvasMouseMove(e);
    }

    _evtNoteMouseEnter(e, note) {
        if (this._state.canShowNoteText) {
            this._showNoteText(note);
        }
    }

    _evtNoteMouseLeave(e) {
        const newElement = e.relatedTarget;
        if (newElement === this._svgNode ||
                (!this._svgNode.contains(newElement) &&
                !this._textNode.contains(newElement) &&
                newElement !== this._textNode)) {
            this._hideNoteText();
        }
    }

    _showNoteText(note) {
        this._textNode.querySelector('.wrapper').innerHTML =
            misc.formatMarkdown(note.text);
        this._textNode.style.display = 'block';
        const polygonRect = note.polygonNode.getBBox();
        const bodyRect = document.body.getBoundingClientRect();
        const noteRect = this._textNode.getBoundingClientRect();
        const svgRect = this.boundingBox;
        const x = (
            -bodyRect.left +
            svgRect.left +
            svgRect.width * (polygonRect.x + polygonRect.width / 2) -
            noteRect.width / 2);
        const y = (
            -bodyRect.top +
            svgRect.top +
            svgRect.height * (polygonRect.y + polygonRect.height / 2) -
            noteRect.height / 2);
        this._textNode.style.left = x + 'px';
        this._textNode.style.top = y + 'px';
    }

    _hideNoteText() {
        this._textNode.style.display = 'none';
    }

    _updatePolygonNotePoints(note) {
        note.polygonNode.setAttribute(
            'points',
            [...note.polygon].map(
                point => [point.x, point.y].join(',')).join(' '));
    }

    _createEdgeNode(point, groupNode) {
        const node = document.createElementNS(svgNS, 'ellipse');
        node.setAttribute('cx', point.x);
        node.setAttribute('cy', point.y);
        node.setAttribute('rx', circleSize / 2 / this.boundingBox.width);
        node.setAttribute('ry', circleSize / 2 / this.boundingBox.height);
        point.edgeNode = node;
        groupNode.appendChild(node);
    }

    _deleteEdgeNode(point, note) {
        this._updatePolygonNotePoints(note);
        point.edgeNode.parentNode.removeChild(point.edgeNode);
    }

    _updateEdgeNode(point, note) {
        this._updatePolygonNotePoints(note);
        point.edgeNode.setAttribute('cx', point.x);
        point.edgeNode.setAttribute('cy', point.y);
    }

    _deletePolygonNode(note) {
        note.polygonNode.parentNode.removeChild(note.polygonNode);
    }

    _createPolygonNode(note) {
        const groupNode = document.createElementNS(svgNS, 'g');
        note.groupNode = groupNode;
        {
            const node = document.createElementNS(svgNS, 'polygon');
            note.polygonNode = node;
            node.setAttribute('vector-effect', 'non-scaling-stroke');
            node.setAttribute('stroke-alignment', 'inside');
            node.addEventListener(
                'mouseenter', e => this._evtNoteMouseEnter(e, note));
            node.addEventListener(
                'mouseleave', e => this._evtNoteMouseLeave(e));
            this._updatePolygonNotePoints(note);
            groupNode.appendChild(node);
        }
        for (let point of note.polygon) {
            this._createEdgeNode(point, groupNode);
        }

        note.polygon.addEventListener('change', e => {
            this._updateEdgeNode(e.detail.point, note);
        });
        note.polygon.addEventListener('remove', e => {
            this._deleteEdgeNode(e.detail.point, note);
        });
        note.polygon.addEventListener('add', e => {
            this._createEdgeNode(e.detail.point, groupNode);
        });

        this._svgNode.appendChild(groupNode);
    }
}

module.exports = PostNotesOverlayControl;