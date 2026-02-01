class GridState {
    constructor () {
        this.slots = this._initializeGrid();
    }

    _initializeGrid () {
        const slots = [];
        const grids = ['A', 'B'];
        const rows = 4;
        const columns = 3;

        grids.forEach(grid => {
            for (let r = 1; r <= rows; r++) {
                for (let c = 1; c <= columns; c++) {
                    slots.push({
                        id: `Grid:${grid}-Row:${r}-Column:${c}`,
                        grid: grid,
                        row: r,
                        column: c,
                        status: 'available', // available, occupied
                        containerId: null,
                        expectedOutboundDate: null,
                        weight: null,
                        receiverId: null
                    });
                }
            }
        });
        return slots;
    }

    getAllSlots () {
        return this.slots;
    }

    getAvailableSlots () {
        return this.slots.filter(s => s.status === 'available');
    }

    occupySlot (slotId, containerId, outboundDate = null, weight = null, receiverId = null) {
        const slot = this.slots.find(s => s.id === slotId);
        if (slot && slot.status === 'available') {
            slot.status = 'occupied';
            slot.containerId = containerId;
            slot.expectedOutboundDate = outboundDate;
            slot.weight = weight;
            slot.receiverId = receiverId;
            return true;
        }
        return false;
    }

    releaseSlot (slotId) {
        const slot = this.slots.find(s => s.id === slotId);
        if (slot) {
            slot.status = 'available';
            slot.containerId = null;
            slot.expectedOutboundDate = null;
            slot.weight = null;
            slot.receiverId = null;
            return true;
        }
        return false;
    }

    resetGrid () {
        this.slots = this._initializeGrid();
    }
}

module.exports = new GridState();
